"""Firestore-backed Notion OAuth token store.

Mirrors the workspace tokens store. Strict auth-plane boundary: doc
values are touched only by the application server (this module + the
notion tool dispatcher); the LLM never sees them.

Per-uid in-memory mutex prevents dogpiling Notion's token endpoint
when two chat turns arrive simultaneously and both find an expired
access token. Notion's `expires_in` for access tokens is ~1h; the
60s skew on `get_valid_access_token` keeps us from handing out a
token that lapses mid-call.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from lifecoach_agent.oauth.notion_client import (
    NotionOAuthClientProtocol,
    NotionTokens,
)
from lifecoach_agent.storage.firestore_session import FirestoreLike


class NotionScopeRequiredError(Exception):
    """The user has revoked Notion access (or the integration was
    removed at notion.so/my-integrations). Tool handlers map this to
    `{status: 'error', code: 'scope_required'}` so the prompt's
    NOTION error-handling block can react with a reconnect prompt."""

    code = "scope_required"

    def __init__(
        self,
        message: str = "Notion access expired. Ask the user to reconnect.",
    ) -> None:
        super().__init__(message)


@dataclass(frozen=True)
class StoredNotionToken:
    uid: str
    accessToken: str  # noqa: N815
    accessTokenExpiresAt: str  # noqa: N815
    refreshToken: str  # noqa: N815
    botId: str  # noqa: N815
    workspaceId: str  # noqa: N815
    workspaceName: str  # noqa: N815
    grantedAt: str  # noqa: N815
    updatedAt: str  # noqa: N815


def _doc_path(uid: str) -> str:
    return f"notionTokens/{uid}"


@dataclass
class _RefreshLocks:
    locks: dict[str, asyncio.Future[str]] = field(default_factory=dict)


class NotionTokensStore:
    def __init__(
        self,
        *,
        firestore: FirestoreLike,
        oauth_client: NotionOAuthClientProtocol,
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

    async def get(self, uid: str) -> StoredNotionToken | None:
        snap = await self._fs.doc(_doc_path(uid)).get()
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return StoredNotionToken(
            uid=data["uid"],
            accessToken=data["accessToken"],
            accessTokenExpiresAt=data["accessTokenExpiresAt"],
            refreshToken=data["refreshToken"],
            botId=data.get("botId", ""),
            workspaceId=data.get("workspaceId", ""),
            workspaceName=data.get("workspaceName", ""),
            grantedAt=data["grantedAt"],
            updatedAt=data["updatedAt"],
        )

    async def set(self, uid: str, tokens: NotionTokens) -> StoredNotionToken:
        existing = await self.get(uid)
        now_iso = self._now_iso()
        stored = StoredNotionToken(
            uid=uid,
            accessToken=tokens.accessToken,
            accessTokenExpiresAt=tokens.accessTokenExpiresAt,
            refreshToken=tokens.refreshToken,
            botId=tokens.botId,
            workspaceId=tokens.workspaceId,
            workspaceName=tokens.workspaceName,
            grantedAt=existing.grantedAt if existing else now_iso,
            updatedAt=now_iso,
        )
        await self._fs.doc(_doc_path(uid)).set(stored.__dict__)
        return stored

    async def delete(self, uid: str) -> None:
        await self._fs.doc(_doc_path(uid)).delete()

    async def _do_refresh(self, uid: str, doc: StoredNotionToken) -> str:
        try:
            refreshed = await self._oauth.refresh_access_token(doc.refreshToken)
        except Exception as err:  # noqa: BLE001
            with contextlib.suppress(Exception):
                await self.delete(uid)
            raise NotionScopeRequiredError() from err

        updated = StoredNotionToken(
            uid=doc.uid,
            accessToken=refreshed.accessToken,
            accessTokenExpiresAt=refreshed.accessTokenExpiresAt,
            refreshToken=refreshed.refreshToken or doc.refreshToken,
            botId=doc.botId,
            workspaceId=doc.workspaceId,
            workspaceName=doc.workspaceName,
            grantedAt=doc.grantedAt,
            updatedAt=self._now_iso(),
        )
        await self._fs.doc(_doc_path(uid)).set(updated.__dict__)
        return updated.accessToken

    async def get_valid_access_token(self, uid: str) -> str:
        doc = await self.get(uid)
        if doc is None or not doc.refreshToken:
            raise NotionScopeRequiredError()

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


def create_notion_tokens_store(
    *,
    firestore: FirestoreLike,
    oauth_client: NotionOAuthClientProtocol,
    now_ms: Callable[[], int] | None = None,
    skew_ms: int = 60_000,
) -> NotionTokensStore:
    return NotionTokensStore(
        firestore=firestore,
        oauth_client=oauth_client,
        now_ms=now_ms,
        skew_ms=skew_ms,
    )


# Re-export for the dispatcher's import convenience — `Any` typed so
# call sites don't have to take an oauth_client dependency at the
# typing layer just to mention this class.
_StoreSentinel: Any = NotionTokensStore
