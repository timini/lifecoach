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
    chatTurnCount: int  # noqa: N815 — lifetime counter, observability + analytics
    # Per-day counter that drives the usage funnel + walls. Resets to 1 on
    # the first /chat of a new local day (timezone passed in via the chat
    # request). Without this the cumulative lifetime count would wall a
    # casual user who hits the threshold over many days even if today's
    # session is two messages — exactly the UX miss that triggered the
    # daily-reset rework.
    dailyTurnCount: int  # noqa: N815
    # YYYY-MM-DD of the user's local day when `dailyTurnCount` was last
    # touched. The increment-time comparison drives the daily rollover.
    dailyTurnCountDate: str  # noqa: N815
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
        # Daily fields are recent — existing pre-rework docs only have
        # chatTurnCount. Default missing daily fields to (0, "") so the
        # next increment treats the user as fresh-today without nuking
        # their lifetime count. This is a one-time soft migration.
        return UserMetaDoc(
            uid=data["uid"],
            chatTurnCount=data["chatTurnCount"],
            dailyTurnCount=data.get("dailyTurnCount", 0),
            dailyTurnCountDate=data.get("dailyTurnCountDate", ""),
            firstSeenAt=data["firstSeenAt"],
            tier=data["tier"],
            updatedAt=data["updatedAt"],
        )

    async def increment_turn_count(
        self,
        uid: str,
        *,
        today_local_date: str | None = None,
    ) -> UserMetaDoc:
        """Bump the lifetime turn counter and the per-day counter.

        `today_local_date` is the user's local YYYY-MM-DD (computed by the
        caller from the request's timezone). The daily counter resets to 1
        on the first /chat of a new local day, so walls and nudges are
        scoped to "today" rather than lifetime. Lifetime `chatTurnCount`
        keeps climbing for observability and analytics.

        Optional for back-compat with callers that haven't been updated;
        when None, the daily counter still rolls forward but resets on a
        UTC day boundary derived from `self._now_iso()`.
        """
        existing = await self.get(uid)
        now_iso = self._now_iso()
        local_day = today_local_date or now_iso[:10]  # YYYY-MM-DD
        if existing is not None:
            # New day → reset daily to 1; same day → daily + 1; existing
            # records without a dailyTurnCountDate (i.e. the pre-rework
            # documents that only had chatTurnCount) start fresh today.
            same_day = existing.dailyTurnCountDate == local_day
            next_daily = existing.dailyTurnCount + 1 if same_day else 1
            nxt = UserMetaDoc(
                uid=existing.uid,
                chatTurnCount=existing.chatTurnCount + 1,
                dailyTurnCount=next_daily,
                dailyTurnCountDate=local_day,
                firstSeenAt=existing.firstSeenAt,
                tier=existing.tier,
                updatedAt=now_iso,
            )
        else:
            nxt = UserMetaDoc(
                uid=uid,
                chatTurnCount=1,
                dailyTurnCount=1,
                dailyTurnCountDate=local_day,
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
                dailyTurnCount=existing.dailyTurnCount,
                dailyTurnCountDate=existing.dailyTurnCountDate,
                firstSeenAt=existing.firstSeenAt,
                tier=tier,
                updatedAt=now_iso,
            )
        else:
            nxt = UserMetaDoc(
                uid=uid,
                chatTurnCount=0,
                dailyTurnCount=0,
                dailyTurnCountDate="",
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
