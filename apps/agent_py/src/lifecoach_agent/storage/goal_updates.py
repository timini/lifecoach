"""Append-only goal-update log at `users/{uid}/goal_updates.json`.

Mirrors `apps/agent/src/storage/goalUpdates.ts`. The last 20 entries
are injected into the system prompt every turn (see prompt builder).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime

from pydantic import ValidationError

from lifecoach_agent.contracts import GoalUpdate
from lifecoach_agent.storage.user_profile import (
    BucketLike,
    NotFoundError,
    _looks_like_not_found,
)


def goal_updates_path(uid: str) -> str:
    return f"users/{uid}/goal_updates.json"


class GoalUpdatesStore:
    def __init__(
        self,
        *,
        bucket: BucketLike,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._bucket = bucket
        self._now = now or (lambda: datetime.now(UTC))

    async def _read_all(self, uid: str) -> list[GoalUpdate]:
        f = self._bucket.file(goal_updates_path(uid))
        try:
            buf = await f.download()
        except NotFoundError:
            return []
        except Exception as err:  # noqa: BLE001
            if _looks_like_not_found(err):
                return []
            return []
        try:
            text = buf.decode("utf-8") if isinstance(buf, bytes) else str(buf)
            parsed = json.loads(text)
        except Exception:  # noqa: BLE001 — bad JSON → start fresh
            return []
        if not isinstance(parsed, list):
            return []
        out: list[GoalUpdate] = []
        for item in parsed:
            try:
                out.append(GoalUpdate.model_validate(item))
            except ValidationError:
                continue
        return out

    async def append(
        self, uid: str, *, goal: str, status: str, note: str | None = None
    ) -> GoalUpdate:
        timestamp = self._now().isoformat().replace("+00:00", "Z")
        full = GoalUpdate.model_validate(
            {
                "timestamp": timestamp,
                "goal": goal,
                "status": status,
                **({"note": note} if note else {}),
            }
        )
        all_entries = await self._read_all(uid)
        all_entries.append(full)
        body = json.dumps([e.model_dump(exclude_none=True) for e in all_entries], indent=2)
        await self._bucket.file(goal_updates_path(uid)).save(body, content_type="application/json")
        return full

    async def recent(self, uid: str, limit: int) -> list[GoalUpdate]:
        all_entries = await self._read_all(uid)
        return all_entries[-limit:] if limit > 0 else []


def create_goal_updates_store(
    *,
    bucket: BucketLike,
    now: Callable[[], datetime] | None = None,
) -> GoalUpdatesStore:
    return GoalUpdatesStore(bucket=bucket, now=now)
