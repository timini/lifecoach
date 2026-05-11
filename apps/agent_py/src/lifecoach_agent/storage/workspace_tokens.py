"""Firestore-backed Workspace OAuth token store.

Mirrors `apps/agent/src/storage/workspaceTokens.ts`. Strict auth-plane
boundary: doc values are touched only by the application server (this
module + tool *handlers*); the LLM never sees them.

Per-uid in-memory mutex prevents dogpiling Google's token endpoint when
two chat turns arrive simultaneously and both find an expired access
token.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from lifecoach_agent.oauth.workspace_client import (
    WorkspaceOAuthClientProtocol,
    WorkspaceTokens,
)
from lifecoach_agent.storage.firestore_session import FirestoreLike


class ScopeRequiredError(Exception):
    """The user has revoked Workspace access (or never granted it).
    Tool handlers map this to `{status: 'error', code: 'scope_required'}`
    so the prompt's WORKSPACE error-handling block can react."""

    code = "scope_required"

    def __init__(
        self,
        message: str = "Workspace access expired. Ask the user to reconnect in Settings.",
    ) -> None:
        super().__init__(message)


@dataclass(frozen=True)
class StoredWorkspaceToken:
    uid: str
    accessToken: str  # noqa: N815 — wire field names preserved
    accessTokenExpiresAt: str  # noqa: N815
    refreshToken: str  # noqa: N815
    scopes: list[str]  # noqa: N815
    grantedAt: str  # noqa: N815
    updatedAt: str  # noqa: N815


def _doc_path(uid: str) -> str:
    return f"workspaceTokens/{uid}"


@dataclass
class _RefreshLocks:
    locks: dict[str, asyncio.Future[str]] = field(default_factory=dict)


class WorkspaceTokensStore:
    def __init__(
        self,
        *,
        firestore: FirestoreLike,
        oauth_client: WorkspaceOAuthClientProtocol,
        now_ms: Callable[[], int] | None = None,
        skew_ms: int = 60_000,
    ) -> None:
        self._fs = firestore
        self._oauth = oauth_client
        self._now_ms = now_ms or (lambda: int(datetime.now(UTC).timestamp() * 1000))
        self._skew_ms = skew_ms
        self._refresh_locks: dict[str, asyncio.Future[str]] = {}

    def _now_iso(self) -> str:
        ms = self._now_ms()
        return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat().replace("+00:00", "Z")

    async def get(self, uid: str) -> StoredWorkspaceToken | None:
        snap = await self._fs.doc(_doc_path(uid)).get()
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return StoredWorkspaceToken(
            uid=data["uid"],
            accessToken=data["accessToken"],
            accessTokenExpiresAt=data["accessTokenExpiresAt"],
            refreshToken=data["refreshToken"],
            scopes=list(data.get("scopes") or []),
            grantedAt=data["grantedAt"],
            updatedAt=data["updatedAt"],
        )

    async def set(self, uid: str, tokens: WorkspaceTokens) -> StoredWorkspaceToken:
        existing = await self.get(uid)
        now_iso = self._now_iso()
        stored = StoredWorkspaceToken(
            uid=uid,
            accessToken=tokens.accessToken,
            accessTokenExpiresAt=tokens.accessTokenExpiresAt,
            refreshToken=tokens.refreshToken,
            scopes=list(tokens.scopes),
            grantedAt=existing.grantedAt if existing else now_iso,
            updatedAt=now_iso,
        )
        await self._fs.doc(_doc_path(uid)).set(stored.__dict__)
        return stored

    async def delete(self, uid: str) -> None:
        await self._fs.doc(_doc_path(uid)).delete()

    async def _do_refresh(self, uid: str, doc: StoredWorkspaceToken) -> str:
        try:
            refreshed = await self._oauth.refresh_access_token(doc.refreshToken)
        except Exception as err:  # noqa: BLE001
            # Refresh failed — user revoked at Google's end, or refresh
            # token expired. Delete the doc so the state machine drops
            # back to google_linked on the next turn.
            with contextlib.suppress(Exception):
                await self.delete(uid)
            raise ScopeRequiredError() from err

        updated = StoredWorkspaceToken(
            uid=doc.uid,
            accessToken=refreshed.accessToken,
            accessTokenExpiresAt=refreshed.accessTokenExpiresAt,
            refreshToken=refreshed.refreshToken or doc.refreshToken,
            scopes=list(doc.scopes),
            grantedAt=doc.grantedAt,
            updatedAt=self._now_iso(),
        )
        await self._fs.doc(_doc_path(uid)).set(updated.__dict__)
        return updated.accessToken

    async def get_valid_access_token(self, uid: str) -> str:
        doc = await self.get(uid)
        if doc is None or not doc.refreshToken:
            raise ScopeRequiredError()

        try:
            expires_at_ms = int(
                datetime.fromisoformat(doc.accessTokenExpiresAt.replace("Z", "+00:00")).timestamp()
                * 1000
            )
        except ValueError:
            expires_at_ms = 0

        if expires_at_ms > self._now_ms() + self._skew_ms:
            return doc.accessToken

        existing = self._refresh_locks.get(uid)
        if existing is not None:
            return await existing

        loop = asyncio.get_running_loop()
        future: asyncio.Future[str] = loop.create_future()
        self._refresh_locks[uid] = future
        try:
            token = await self._do_refresh(uid, doc)
            future.set_result(token)
            return token
        except BaseException as err:
            if not future.done():
                future.set_exception(err)
            raise
        finally:
            self._refresh_locks.pop(uid, None)


def create_workspace_tokens_store(
    *,
    firestore: FirestoreLike,
    oauth_client: WorkspaceOAuthClientProtocol,
    now_ms: Callable[[], int] | None = None,
    skew_ms: int = 60_000,
) -> WorkspaceTokensStore:
    return WorkspaceTokensStore(
        firestore=firestore,
        oauth_client=oauth_client,
        now_ms=now_ms,
        skew_ms=skew_ms,
    )
