"""Notion OAuth client — public-integration auth-code flow.

Talks to `https://api.notion.com/v1/oauth/token` for both code exchange
and refresh-token rotation. Mirrors the workspace OAuth client's shape;
the differences from Google:

  - Notion uses HTTP **Basic** auth with `client_id:client_secret` for
    the token endpoint, not body fields.
  - Notion has **no programmatic revoke**. The DELETE flow in
    `server.py` deletes our token doc; the user must also remove the
    integration at notion.so/my-integrations to fully sever.
  - Public-integration access tokens expire (~1h); refresh tokens were
    introduced for public integrations in Apr 2024.
  - The exchange response carries `workspace_id`, `workspace_name`,
    `bot_id`, and `owner` — we keep them on the dataclass so the
    server's OAuth handler can persist them alongside the token doc.

Token material returned here never reaches the LLM. Callers are the
application server's OAuth callback handler and the Firestore token
store's refresh path (`storage.notion_tokens`).
"""

from __future__ import annotations

import base64
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token"

# Notion access tokens typically expire after ~1h. Cushion the stored
# expiry by 5 minutes (mirrors workspace client's behaviour) so the
# token store's `get_valid_access_token` does not return a token that
# is about to lapse mid-tool-call.
_FALLBACK_EXPIRY_S = 55 * 60


@dataclass(frozen=True)
class NotionTokens:
    """Token material held by the application server. Never reaches the
    LLM. Stored in Firestore by the notion_tokens store; retrieved only
    inside tool *handlers*.

    `bot_id` / `workspace_id` / `workspace_name` come from the exchange
    response and pin which Notion workspace this integration was granted
    against — surfaced in the settings row + used by the config doc to
    select a parent page for the auto-created Lifecoach Tasks DB."""

    accessToken: str  # noqa: N815
    accessTokenExpiresAt: str  # noqa: N815 — ISO 8601
    refreshToken: str  # noqa: N815
    botId: str  # noqa: N815
    workspaceId: str  # noqa: N815
    workspaceName: str  # noqa: N815
    # Owner shape (user vs. workspace) — keep raw for forward-compat.
    owner: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class NotionRefreshResult:
    """Output of `NotionOAuthClient.refresh_access_token`."""

    accessToken: str  # noqa: N815
    accessTokenExpiresAt: str  # noqa: N815
    # Notion may rotate the refresh token; if present the store
    # overwrites the previous one.
    refreshToken: str | None = None  # noqa: N815


HttpClient = httpx.AsyncClient


def _ms_now() -> int:
    return int(time.time() * 1000)


def _expiry_iso(expiry_ms: int | None, now_ms: Callable[[], int]) -> str:
    if expiry_ms is None or not isinstance(expiry_ms, int):
        ts_ms = now_ms() + _FALLBACK_EXPIRY_S * 1000
    else:
        ts_ms = expiry_ms
    seconds, milliseconds = divmod(ts_ms, 1000)
    from datetime import UTC, datetime  # local import — match workspace_client

    dt = datetime.fromtimestamp(seconds, tz=UTC)
    return f"{dt.strftime('%Y-%m-%dT%H:%M:%S')}.{milliseconds:03d}Z"


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    raw = f"{client_id}:{client_secret}".encode()
    return f"Basic {base64.b64encode(raw).decode('ascii')}"


class NotionOAuthClient:
    """Narrow surface used by the OAuth callback + token store.

    Constructed via :func:`create_notion_oauth_client` so tests can swap
    in an `httpx.AsyncClient` bound to `respx.mock`. Production wiring
    injects a real `httpx.AsyncClient`.
    """

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        http: httpx.AsyncClient,
        now_ms: Callable[[], int] | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = http
        self._now_ms = now_ms or _ms_now
        self._auth_header = _basic_auth_header(client_id, client_secret)

    async def exchange_code(self, code: str, redirect_uri: str) -> NotionTokens:
        """Exchange an auth code (from the browser popup) for tokens.

        `redirect_uri` is the same one used in the authorize URL — Notion
        requires it to match exactly (no `postmessage` magic like
        Google's GIS popup). The web app's `notion/callback` page hosts
        the redirect URI; the server forwards the value here so it
        round-trips through the exchange unchanged.
        """
        body = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }
        res = await self._http.post(
            NOTION_TOKEN_URL,
            json=body,
            headers={
                "Accept": "application/json",
                "Authorization": self._auth_header,
                "Notion-Version": "2022-06-28",
            },
        )
        if res.status_code != 200:
            raise RuntimeError(
                f"notion-oauth-exchange: token endpoint returned {res.status_code}: "
                f"{res.text[:200]}"
            )
        payload: dict[str, Any] = res.json()
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token")
        if not isinstance(access_token, str) or not access_token:
            raise RuntimeError("notion-oauth-exchange: missing access_token in response")
        if not isinstance(refresh_token, str) or not refresh_token:
            raise RuntimeError("notion-oauth-exchange: missing refresh_token in response")

        expires_in = payload.get("expires_in")
        expiry_ms: int | None
        if isinstance(expires_in, int) and expires_in > 0:
            expiry_ms = self._now_ms() + expires_in * 1000
        else:
            expiry_ms = None

        return NotionTokens(
            accessToken=access_token,
            accessTokenExpiresAt=_expiry_iso(expiry_ms, self._now_ms),
            refreshToken=refresh_token,
            botId=payload.get("bot_id") or "",
            workspaceId=payload.get("workspace_id") or "",
            workspaceName=payload.get("workspace_name") or "",
            owner=payload.get("owner") if isinstance(payload.get("owner"), dict) else {},
        )

    async def refresh_access_token(self, refresh_token: str) -> NotionRefreshResult:
        body = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        res = await self._http.post(
            NOTION_TOKEN_URL,
            json=body,
            headers={
                "Accept": "application/json",
                "Authorization": self._auth_header,
                "Notion-Version": "2022-06-28",
            },
        )
        if res.status_code != 200:
            raise RuntimeError(
                f"notion-oauth-refresh: token endpoint returned {res.status_code}: {res.text[:200]}"
            )
        payload: dict[str, Any] = res.json()
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise RuntimeError("notion-oauth-refresh: missing access_token in response")

        expires_in = payload.get("expires_in")
        expiry_ms: int | None
        if isinstance(expires_in, int) and expires_in > 0:
            expiry_ms = self._now_ms() + expires_in * 1000
        else:
            expiry_ms = None

        rotated = payload.get("refresh_token")
        return NotionRefreshResult(
            accessToken=access_token,
            accessTokenExpiresAt=_expiry_iso(expiry_ms, self._now_ms),
            refreshToken=rotated if isinstance(rotated, str) and rotated else None,
        )


def create_notion_oauth_client(
    *,
    client_id: str,
    client_secret: str,
    http: httpx.AsyncClient,
    now_ms: Callable[[], int] | None = None,
) -> NotionOAuthClient:
    return NotionOAuthClient(
        client_id=client_id,
        client_secret=client_secret,
        http=http,
        now_ms=now_ms,
    )


class NotionOAuthClientProtocol(Protocol):
    """Structural shape `notion_tokens.NotionTokensStore` depends on.
    Only `refresh_access_token` is required by the store — `exchange_code`
    is called by the OAuth callback route, which holds the concrete
    `NotionOAuthClient`."""

    async def exchange_code(self, code: str, redirect_uri: str) -> NotionTokens: ...

    async def refresh_access_token(self, refresh_token: str) -> NotionRefreshResult: ...
