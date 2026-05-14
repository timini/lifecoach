"""Per-uid Notion config (auto-created tasks DB id + granted pages).

Distinct from `notion_tokens.py` so the OAuth + DB-bootstrap concerns
have independent doc shapes and independent test surfaces. The token
store rotates frequently (every ~hour as access tokens refresh); the
config doc is essentially write-once per user (set on first connect,
updated only when the bootstrap creates the DB or re-discovers it
after a re-grant).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from lifecoach_agent.storage.firestore_session import FirestoreLike


@dataclass(frozen=True)
class StoredNotionConfig:
    uid: str
    # The auto-created "Lifecoach Tasks" database id. `None` means the
    # bootstrap hasn't run yet (or was cleared after an
    # `object_not_found` from Notion → re-bootstrap on next call).
    databaseId: str | None  # noqa: N815
    workspaceId: str  # noqa: N815 — mirrors the token doc for speed
    # Parent pages granted during OAuth consent. The bootstrap picks the
    # first one as the parent for the auto-created tasks DB.
    grantedParentPageIds: list[str]  # noqa: N815
    updatedAt: str  # noqa: N815


def _doc_path(uid: str) -> str:
    return f"notionConfig/{uid}"


class NotionConfigStore:
    def __init__(
        self,
        *,
        firestore: FirestoreLike,
        now_ms: Callable[[], int] | None = None,
    ) -> None:
        self._fs = firestore
        self._now_ms = now_ms or (lambda: int(datetime.now(UTC).timestamp() * 1000))

    def _now_iso(self) -> str:
        ms = self._now_ms()
        return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat().replace("+00:00", "Z")

    async def get(self, uid: str) -> StoredNotionConfig | None:
        snap = await self._fs.doc(_doc_path(uid)).get()
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return StoredNotionConfig(
            uid=data["uid"],
            databaseId=data.get("databaseId"),
            workspaceId=data.get("workspaceId", ""),
            grantedParentPageIds=list(data.get("grantedParentPageIds") or []),
            updatedAt=data["updatedAt"],
        )

    async def set(
        self,
        uid: str,
        *,
        workspace_id: str,
        granted_parent_page_ids: list[str],
        database_id: str | None = None,
    ) -> StoredNotionConfig:
        stored = StoredNotionConfig(
            uid=uid,
            databaseId=database_id,
            workspaceId=workspace_id,
            grantedParentPageIds=list(granted_parent_page_ids),
            updatedAt=self._now_iso(),
        )
        await self._fs.doc(_doc_path(uid)).set(stored.__dict__)
        return stored

    async def set_granted_parent_page_ids(
        self, uid: str, granted_parent_page_ids: list[str]
    ) -> StoredNotionConfig:
        """Replace the granted parent pages without touching the
        database id — called by the bootstrap after a lazy `/v1/search`
        discovers pages the integration was granted access to (the
        OAuth exchange response does not enumerate pages, so the first
        bootstrap call has to find them)."""
        existing = await self.get(uid)
        if existing is None:
            return await self.set(
                uid,
                workspace_id="",
                granted_parent_page_ids=granted_parent_page_ids,
                database_id=None,
            )
        updated = StoredNotionConfig(
            uid=existing.uid,
            databaseId=existing.databaseId,
            workspaceId=existing.workspaceId,
            grantedParentPageIds=list(granted_parent_page_ids),
            updatedAt=self._now_iso(),
        )
        await self._fs.doc(_doc_path(uid)).set(updated.__dict__)
        return updated

    async def set_database_id(self, uid: str, database_id: str | None) -> StoredNotionConfig:
        """Update the bootstrapped database id without touching the
        grantedParentPageIds — called by `database_bootstrap.py` once
        it has the new id, and by the post-revoke recovery path with
        `None` to force a re-bootstrap."""
        existing = await self.get(uid)
        if existing is None:
            # No config yet — caller should have called `set()` first
            # during the OAuth exchange. Synthesize a minimal doc with
            # just the database_id so we never lose state.
            return await self.set(
                uid,
                workspace_id="",
                granted_parent_page_ids=[],
                database_id=database_id,
            )
        updated = StoredNotionConfig(
            uid=existing.uid,
            databaseId=database_id,
            workspaceId=existing.workspaceId,
            grantedParentPageIds=list(existing.grantedParentPageIds),
            updatedAt=self._now_iso(),
        )
        await self._fs.doc(_doc_path(uid)).set(updated.__dict__)
        return updated

    async def delete(self, uid: str) -> None:
        await self._fs.doc(_doc_path(uid)).delete()


def create_notion_config_store(
    *,
    firestore: FirestoreLike,
    now_ms: Callable[[], int] | None = None,
) -> NotionConfigStore:
    return NotionConfigStore(firestore=firestore, now_ms=now_ms)
