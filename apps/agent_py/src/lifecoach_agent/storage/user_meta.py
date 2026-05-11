"""Firestore-backed per-uid usage meta. Mirrors
`apps/agent/src/storage/userMeta.ts`.

Storage layout: `userMeta/{uid}` →
  { uid, chatTurnCount, firstSeenAt, tier, updatedAt }
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from lifecoach_agent.state import Tier
from lifecoach_agent.storage.firestore_session import FirestoreLike


@dataclass(frozen=True)
class UserMetaDoc:
    uid: str
    chatTurnCount: int  # noqa: N815 — wire field name preserved
    firstSeenAt: str  # noqa: N815
    tier: Tier
    updatedAt: str  # noqa: N815


def _doc_path(uid: str) -> str:
    return f"userMeta/{uid}"


class UserMetaStore:
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

    async def get(self, uid: str) -> UserMetaDoc | None:
        snap = await self._fs.doc(_doc_path(uid)).get()
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return UserMetaDoc(
            uid=data["uid"],
            chatTurnCount=data["chatTurnCount"],
            firstSeenAt=data["firstSeenAt"],
            tier=data["tier"],
            updatedAt=data["updatedAt"],
        )

    async def increment_turn_count(self, uid: str) -> UserMetaDoc:
        existing = await self.get(uid)
        now_iso = self._now_iso()
        if existing is not None:
            nxt = UserMetaDoc(
                uid=existing.uid,
                chatTurnCount=existing.chatTurnCount + 1,
                firstSeenAt=existing.firstSeenAt,
                tier=existing.tier,
                updatedAt=now_iso,
            )
        else:
            nxt = UserMetaDoc(
                uid=uid,
                chatTurnCount=1,
                firstSeenAt=now_iso,
                tier="free",
                updatedAt=now_iso,
            )
        await self._fs.doc(_doc_path(uid)).set(nxt.__dict__)
        return nxt

    async def set_tier(self, uid: str, tier: Tier) -> UserMetaDoc:
        existing = await self.get(uid)
        now_iso = self._now_iso()
        if existing is not None:
            nxt = UserMetaDoc(
                uid=existing.uid,
                chatTurnCount=existing.chatTurnCount,
                firstSeenAt=existing.firstSeenAt,
                tier=tier,
                updatedAt=now_iso,
            )
        else:
            nxt = UserMetaDoc(
                uid=uid,
                chatTurnCount=0,
                firstSeenAt=now_iso,
                tier=tier,
                updatedAt=now_iso,
            )
        await self._fs.doc(_doc_path(uid)).set(nxt.__dict__)
        return nxt


def create_user_meta_store(
    *,
    firestore: FirestoreLike,
    now_ms: Callable[[], int] | None = None,
) -> UserMetaStore:
    return UserMetaStore(firestore=firestore, now_ms=now_ms)
