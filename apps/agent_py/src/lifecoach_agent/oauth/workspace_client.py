"""Workspace OAuth client — direct to Google's token endpoint.

Mirrors `apps/agent/src/oauth/workspaceClient.ts`. The TS port wraps
`google-auth-library`'s OAuth2Client; the Python port talks to
`https://oauth2.googleapis.com/token` directly with `httpx.AsyncClient`
to avoid pulling in google-auth's heavy auth surface (and to make the
wire shape obvious + mockable via `respx`).

Token material returned here never reaches the LLM. Callers are the
application server's OAuth callback handler (Phase 9) and the Firestore
token store's refresh path (`storage.workspace_tokens`).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

# Fallback expiry when Google omits expires_in: ~55 minutes. Google's
# default access-token lifetime is 60 minutes; the 5-minute cushion
# keeps the workspace_tokens store's `getValidAccessToken` from
# returning a token that's about to lapse mid-tool-call.
_FALLBACK_EXPIRY_S = 55 * 60


@dataclass(frozen=True)
class WorkspaceTokens:
    """Token material held by the application server. Never reaches the
    LLM. Stored in Firestore by the workspace_tokens store; retrieved
    only inside tool *handlers*."""

    accessToken: str  # noqa: N815 — wire field name preserved for parity
    accessTokenExpiresAt: str  # noqa: N815 — ISO 8601
    refreshToken: str  # noqa: N815
    scopes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RefreshResult:
    """Output of `WorkspaceOAuthClient.refresh_access_token`."""

    accessToken: str  # noqa: N815
    accessTokenExpiresAt: str  # noqa: N815 — ISO 8601
    # Google may rotate the refresh token; if present the store
    # overwrites the previous one.
    refreshToken: str | None = None  # noqa: N815


# Pluggable HTTP client. Tests inject one driven by `respx`.
HttpClient = httpx.AsyncClient


def _ms_now() -> int:
    return int(time.time() * 1000)


def _expiry_iso(expiry_ms: int | None, now_ms: Callable[[], int]) -> str:
    """Format an expiry timestamp as ISO 8601 UTC with millisecond
    precision (matching JS `new Date(...).toISOString()` shape)."""
    if expiry_ms is None or not isinstance(expiry_ms, int):
        ts_ms = now_ms() + _FALLBACK_EXPIRY_S * 1000
    else:
        ts_ms = expiry_ms
    # Build "YYYY-MM-DDTHH:MM:SS.sssZ" deterministically.
    seconds, milliseconds = divmod(ts_ms, 1000)
    from datetime import UTC, datetime  # local import — avoid module-load cycle noise

    dt = datetime.fromtimestamp(seconds, tz=UTC)
    return f"{dt.strftime('%Y-%m-%dT%H:%M:%S')}.{milliseconds:03d}Z"


class WorkspaceOAuthClient:
    """Narrow surface used by tool handlers + the OAuth callback.

    Constructed via :func:`create_workspace_oauth_client` so tests can
    swap in an `httpx.AsyncClient` bound to `respx.mock`. Production
    wiring (Phase 9) injects a real `httpx.AsyncClient`.
    """

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str = "postmessage",
        http: httpx.AsyncClient,
        now_ms: Callable[[], int] | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._http = http
        self._now_ms = now_ms or _ms_now

    async def exchange_code(self, code: str) -> WorkspaceTokens:
        """Exchange an auth code (from the browser's GIS popup) for
        tokens."""
        body = {
            "code": code,
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "redirect_uri": self._redirect_uri,
            "grant_type": "authorization_code",
        }
        res = await self._http.post(
            GOOGLE_TOKEN_URL,
            data=body,
            headers={"Accept": "application/json"},
        )
        if res.status_code != 200:
            raise RuntimeError(
                f"oauth-exchange: token endpoint returned {res.status_code}: {res.text[:200]}"
            )
        payload: dict[str, Any] = res.json()
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token")
        if not isinstance(access_token, str) or not access_token:
            raise RuntimeError("oauth-exchange: missing access_token in response")
        if not isinstance(refresh_token, str) or not refresh_token:
            raise RuntimeError("oauth-exchange: missing refresh_token in response")

        expires_in = payload.get("expires_in")
        expiry_ms: int | None
        if isinstance(expires_in, int) and expires_in > 0:
            expiry_ms = self._now_ms() + expires_in * 1000
        else:
            expiry_ms = None

        scope_str = payload.get("scope") or ""
        scopes = [s for s in scope_str.split() if s] if isinstance(scope_str, str) else []

        return WorkspaceTokens(
            accessToken=access_token,
            accessTokenExpiresAt=_expiry_iso(expiry_ms, self._now_ms),
            refreshToken=refresh_token,
            scopes=scopes,
        )

    async def refresh_access_token(self, refresh_token: str) -> RefreshResult:
        """Refresh the access token using a stored refresh token."""
        body = {
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        res = await self._http.post(
            GOOGLE_TOKEN_URL,
            data=body,
            headers={"Accept": "application/json"},
        )
        if res.status_code != 200:
            raise RuntimeError(
                f"oauth-refresh: token endpoint returned {res.status_code}: {res.text[:200]}"
            )
        payload: dict[str, Any] = res.json()
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise RuntimeError("oauth-refresh: missing access_token in response")

        expires_in = payload.get("expires_in")
        expiry_ms: int | None
        if isinstance(expires_in, int) and expires_in > 0:
            expiry_ms = self._now_ms() + expires_in * 1000
        else:
            expiry_ms = None

        rotated = payload.get("refresh_token")
        return RefreshResult(
            accessToken=access_token,
            accessTokenExpiresAt=_expiry_iso(expiry_ms, self._now_ms),
            refreshToken=rotated if isinstance(rotated, str) and rotated else None,
        )

    async def revoke_refresh_token(self, refresh_token: str) -> None:
        """Best-effort revoke at Google's end. Errors are swallowed —
        the doc-DELETE path has already succeeded by the time we get
        here, so a 400 from Google ("token already revoked") is fine."""
        try:
            await self._http.post(
                GOOGLE_REVOKE_URL,
                data={"token": refresh_token},
                headers={"Accept": "application/json"},
            )
        except Exception:  # noqa: BLE001 — best-effort
            return


def create_workspace_oauth_client(
    *,
    client_id: str,
    client_secret: str,
    http: httpx.AsyncClient,
    redirect_uri: str = "postmessage",
    now_ms: Callable[[], int] | None = None,
) -> WorkspaceOAuthClient:
    """Factory mirroring the TS `createWorkspaceOAuthClient`."""
    return WorkspaceOAuthClient(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        http=http,
        now_ms=now_ms,
    )


# --- Protocol for the workspace_tokens store ----------------------------


class WorkspaceOAuthClientProtocol(Protocol):
    """Structural shape `workspace_tokens.WorkspaceTokensStore` depends on.

    The concrete `WorkspaceOAuthClient` above satisfies it; tests can
    construct ad-hoc fakes that implement just `refresh_access_token`
    (and `revoke_refresh_token`) since `exchange_code` isn't called by
    the store.
    """

    async def exchange_code(self, code: str) -> WorkspaceTokens: ...

    async def refresh_access_token(self, refresh_token: str) -> RefreshResult: ...

    async def revoke_refresh_token(self, refresh_token: str) -> None: ...
