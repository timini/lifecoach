"""Firestore-backed store for `backgroundSchedules` (ADR 0001, step 2a).

Owns the bounded due-query the dispatcher sweeps each tick, and the
transactional lease-claim primitive (the **required** dedupe layer — see
ADR §2). Lease fields (`pendingRunId`, `leaseExpiresAt`) live on the
schedule doc but are operational, not part of the `BackgroundSchedule`
contract, so they're read/written directly here and stripped on read-back.

Timestamps are stored in the canonical millisecond-precision UTC form
(`background_time.canonical_iso`) so the due-query's `order_by("nextRunAt")`
and the lease's `leaseExpiresAt > now` comparison are correct lexicographic
string operations regardless of the caller's fractional precision.

> Real-Firestore note: the due-query is a compound `enabled == true` +
> `nextRunAt` range/order, which needs the `backgroundSchedules(enabled,
> nextRunAt)` composite index. That index is provisioned in ADR step 4e
> (Terraform); without it the first production sweep fails with a
> missing-index precondition.
"""

from __future__ import annotations

from collections.abc import Callable

from lifecoach_agent.contracts.background import SCHEDULE_LAST_STATUSES, BackgroundSchedule
from lifecoach_agent.storage.background_firestore import (
    BackgroundFirestore,
    BgTransaction,
)
from lifecoach_agent.storage.background_time import canonical_iso
from lifecoach_agent.storage.background_time import now_iso as _now_iso_default

_COLLECTION = "backgroundSchedules"

# Operational lease fields kept off the BackgroundSchedule contract.
_LEASE_FIELDS = ("pendingRunId", "leaseExpiresAt")


def _doc_path(schedule_id: str) -> str:
    return f"{_COLLECTION}/{schedule_id}"


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
        self._now_iso = now_iso or _now_iso_default

    async def upsert(self, schedule: BackgroundSchedule) -> None:
        """Create or replace a schedule, preserving any in-flight lease. The
        read + write happen in one transaction so a concurrent `claim_lease`
        can't be clobbered by a stale settings-UI save (PR #193 review)."""
        path = _doc_path(schedule.id)
        doc = schedule.model_dump(exclude_none=True)
        doc["nextRunAt"] = canonical_iso(str(doc["nextRunAt"]))

        async def _txn(txn: BgTransaction) -> None:
            existing = await txn.get(path)
            merged = dict(doc)
            if existing.exists:
                prior = existing.data() or {}
                for field in _LEASE_FIELDS:
                    if field in prior:
                        merged[field] = prior[field]
            txn.set(path, merged)

        await self._fs.run_transaction(_txn)

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
        now = canonical_iso(now_iso) if now_iso else self._now_iso()
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
        """Atomically claim the schedule for one dispatch. Re-reads the doc in
        the transaction and refuses to claim when, since `query_due` ran, the
        schedule was deleted, disabled, moved into the future, or already has a
        *valid* lease (a prior tick is mid-enqueue). Returns True only when the
        caller may create the run record + enqueue the task."""
        now = canonical_iso(now_iso) if now_iso else self._now_iso()
        lease_until = canonical_iso(lease_expires_at)
        path = _doc_path(schedule_id)

        async def _txn(txn: BgTransaction) -> bool:
            snap = await txn.get(path)
            if not snap.exists:
                return False
            data = snap.data() or {}
            # Re-validate state under the lock — query_due's snapshot is stale.
            if data.get("enabled") is not True:
                return False
            next_run_at = data.get("nextRunAt")
            if not isinstance(next_run_at, str) or next_run_at > now:
                return False
            held = data.get("pendingRunId")
            expires = data.get("leaseExpiresAt")
            if held and isinstance(expires, str) and expires > now:
                return False
            txn.update(path, {"pendingRunId": run_id, "leaseExpiresAt": lease_until})
            return True

        return await self._fs.run_transaction(_txn)

    async def release_lease_and_advance(
        self,
        *,
        schedule_id: str,
        run_id: str,
        next_run_at: str,
        last_status: str | None = None,
        last_run_at: str | None = None,
    ) -> bool:
        """Second transaction after enqueue: clear the lease and roll
        `nextRunAt` forward — but only if *this* dispatcher still holds the
        lease (`pendingRunId == run_id`). If a newer tick reclaimed an expired
        lease, leave its claim untouched (PR #193 review). Returns True iff the
        release was applied.

        `last_status` is the **run outcome** (`ok`/`skipped`/`failed`), owned by
        the executor — the dispatcher omits it (advances scheduling only) and
        leaves the prior `lastRunAt`/`lastStatus` untouched."""
        if last_status is not None and last_status not in SCHEDULE_LAST_STATUSES:
            raise ValueError(f"last_status must be one of {SCHEDULE_LAST_STATUSES}: {last_status}")
        path = _doc_path(schedule_id)
        advanced = canonical_iso(next_run_at)

        async def _txn(txn: BgTransaction) -> bool:
            snap = await txn.get(path)
            if not snap.exists:
                return False
            data = snap.data() or {}
            if data.get("pendingRunId") != run_id:
                return False
            now = self._now_iso()
            update: dict[str, object] = {
                "pendingRunId": None,
                "leaseExpiresAt": None,
                "nextRunAt": advanced,
                "updatedAt": now,
            }
            if last_status is not None:
                update["lastStatus"] = last_status
                update["lastRunAt"] = canonical_iso(last_run_at) if last_run_at else now
            txn.update(path, update)
            return True

        return await self._fs.run_transaction(_txn)


def create_background_schedule_store(
    *,
    firestore: BackgroundFirestore,
    now_iso: Callable[[], str] | None = None,
) -> BackgroundScheduleStore:
    return BackgroundScheduleStore(firestore=firestore, now_iso=now_iso)
