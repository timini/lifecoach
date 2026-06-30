"""Firestore-backed store for `backgroundSchedules` (ADR 0001, step 2a).

Owns the bounded due-query the dispatcher sweeps each tick, and the
transactional lease-claim primitive (the **required** dedupe layer — see
ADR §2). Lease fields (`pendingRunId`, `leaseExpiresAt`) live on the
schedule doc but are operational, not part of the `BackgroundSchedule`
contract, so they're read/written directly here and stripped on read-back.

`nextRunAt` and `leaseExpiresAt` are stored as ISO-8601 UTC `…Z` strings,
which sort lexicographically in chronological order — so the due-query's
`order_by("nextRunAt")` and the lease's `leaseExpiresAt > now` comparison
are correct string operations.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from lifecoach_agent.contracts.background import BackgroundSchedule
from lifecoach_agent.storage.background_firestore import (
    BackgroundFirestore,
    BgTransaction,
)

_COLLECTION = "backgroundSchedules"

# Operational lease fields kept off the BackgroundSchedule contract.
_LEASE_FIELDS = ("pendingRunId", "leaseExpiresAt")


def _doc_path(schedule_id: str) -> str:
    return f"{_COLLECTION}/{schedule_id}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _strip_lease(data: dict[str, object]) -> dict[str, object]:
    return {k: v for k, v in data.items() if k not in _LEASE_FIELDS}


class BackgroundScheduleStore:
    def __init__(
        self,
        *,
        firestore: BackgroundFirestore,
        now_iso: Callable[[], str] | None = None,
    ) -> None:
        self._fs = firestore
        self._now_iso = now_iso or _now_iso

    async def upsert(self, schedule: BackgroundSchedule) -> None:
        """Create or replace a schedule. Preserves any in-flight lease that
        a concurrent tick may hold by merging lease fields back on top."""
        path = _doc_path(schedule.id)
        existing = await self._fs.get(path)
        doc = schedule.model_dump(exclude_none=True)
        if existing.exists:
            prior = existing.data() or {}
            for field in _LEASE_FIELDS:
                if field in prior:
                    doc[field] = prior[field]
        await self._fs.set(path, doc)

    async def get(self, schedule_id: str) -> BackgroundSchedule | None:
        snap = await self._fs.get(_doc_path(schedule_id))
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return BackgroundSchedule.model_validate(_strip_lease(data))

    async def query_due(
        self, *, limit: int, now_iso: str | None = None
    ) -> list[BackgroundSchedule]:
        """Enabled schedules whose `nextRunAt <= now`, oldest first, bounded
        to `limit`. The dispatcher drains a backlog across multiple ticks
        rather than in one call (ADR §2)."""
        now = now_iso or self._now_iso()
        snaps = await self._fs.query(
            _COLLECTION,
            filters=[("enabled", "==", True), ("nextRunAt", "<=", now)],
            order_by="nextRunAt",
            limit=limit,
        )
        out: list[BackgroundSchedule] = []
        for snap in snaps:
            data = snap.data()
            if data:
                out.append(BackgroundSchedule.model_validate(_strip_lease(data)))
        return out

    async def claim_lease(
        self,
        *,
        schedule_id: str,
        run_id: str,
        lease_expires_at: str,
        now_iso: str | None = None,
    ) -> bool:
        """Atomically claim the schedule for one dispatch. Returns False if
        the schedule is gone or a *valid* lease is already held (a prior tick
        is mid-enqueue). The caller creates the run record + enqueues the task
        only when this returns True."""
        now = now_iso or self._now_iso()
        path = _doc_path(schedule_id)

        async def _txn(txn: BgTransaction) -> bool:
            snap = await txn.get(path)
            if not snap.exists:
                return False
            data = snap.data() or {}
            held = data.get("pendingRunId")
            expires = data.get("leaseExpiresAt")
            if held and isinstance(expires, str) and expires > now:
                return False
            txn.update(path, {"pendingRunId": run_id, "leaseExpiresAt": lease_expires_at})
            return True

        return await self._fs.run_transaction(_txn)

    async def release_lease_and_advance(
        self,
        *,
        schedule_id: str,
        next_run_at: str,
        last_status: str,
        last_run_at: str | None = None,
    ) -> None:
        """Second transaction after enqueue succeeds: clear the lease and
        roll `nextRunAt` forward so the next tick won't re-dispatch this
        occurrence (ADR §2)."""
        path = _doc_path(schedule_id)
        ran_at = last_run_at or self._now_iso()

        async def _txn(txn: BgTransaction) -> None:
            snap = await txn.get(path)
            if not snap.exists:
                return
            txn.update(
                path,
                {
                    "pendingRunId": None,
                    "leaseExpiresAt": None,
                    "nextRunAt": next_run_at,
                    "lastRunAt": ran_at,
                    "lastStatus": last_status,
                    "updatedAt": ran_at,
                },
            )

        await self._fs.run_transaction(_txn)


def create_background_schedule_store(
    *,
    firestore: BackgroundFirestore,
    now_iso: Callable[[], str] | None = None,
) -> BackgroundScheduleStore:
    return BackgroundScheduleStore(firestore=firestore, now_iso=now_iso)
