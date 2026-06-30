"""Firestore-backed store for `backgroundRuns` (ADR 0001, step 2b).

The app owns terminal state — Cloud Tasks is at-least-once and may delete
tasks that exhaust retries, so every terminal outcome is persisted here,
never left to the queue as a dead-letter (ADR §3).

Three responsibilities:
- **lease-claim on execute** (`claim_for_execution`): a transaction that
  flips a run from `queued`/`retryable_failed` to `running`. A duplicate
  Cloud Task delivery for a run that's already `running` or terminal returns
  None — the replay is a no-op, so digests/actions never duplicate.
- **idempotency-key dedupe** (`find_by_idempotency_key`): the second dedupe
  layer behind the schedule lease + deterministic task ID.
- **terminal-failure persistence** (`mark_*`): stable `errorCode` only; raw
  third-party exception text must never be stored (ADR §Error sanitization).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from lifecoach_agent.contracts.background import BackgroundRun
from lifecoach_agent.storage.background_firestore import (
    BackgroundFirestore,
    BgTransaction,
)

_COLLECTION = "backgroundRuns"

# A run in one of these states may be claimed for (re-)execution. Anything
# else — running (valid lease), succeeded, skipped, terminal_failed,
# cancelled, superseded — is left untouched so a duplicate delivery no-ops.
_CLAIMABLE = ("queued", "retryable_failed")


def _doc_path(run_id: str) -> str:
    return f"{_COLLECTION}/{run_id}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class BackgroundRunStore:
    def __init__(
        self,
        *,
        firestore: BackgroundFirestore,
        now_iso: Callable[[], str] | None = None,
    ) -> None:
        self._fs = firestore
        self._now_iso = now_iso or _now_iso

    async def create(self, run: BackgroundRun) -> None:
        """Write the run record (status `queued`) — the dispatcher's first
        write after claiming the schedule lease."""
        await self._fs.set(_doc_path(run.id), run.model_dump(exclude_none=True))

    async def get(self, run_id: str) -> BackgroundRun | None:
        snap = await self._fs.get(_doc_path(run_id))
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return BackgroundRun.model_validate(data)

    async def find_by_idempotency_key(self, idempotency_key: str) -> BackgroundRun | None:
        """Second dedupe layer: has a run for this `{scheduleId}:{kind}:
        {scheduledFor}` already been created? Returns the existing run so the
        dispatcher can skip re-creating it."""
        snaps = await self._fs.query(
            _COLLECTION,
            filters=[("idempotencyKey", "==", idempotency_key)],
            order_by="createdAt",
            limit=1,
        )
        for snap in snaps:
            data = snap.data()
            if data:
                return BackgroundRun.model_validate(data)
        return None

    async def claim_for_execution(
        self,
        *,
        run_id: str,
        lease_expires_at: str,
        now_iso: str | None = None,
    ) -> BackgroundRun | None:
        """Atomically flip a claimable run to `running`. Returns the updated
        run, or None if the run is missing or already running/terminal (a
        duplicate Cloud Task delivery — the executor must treat None as
        'someone else has this; do nothing')."""
        now = now_iso or self._now_iso()
        path = _doc_path(run_id)

        async def _txn(txn: BgTransaction) -> BackgroundRun | None:
            snap = await txn.get(path)
            if not snap.exists:
                return None
            data = snap.data() or {}
            if data.get("status") not in _CLAIMABLE:
                return None
            updated = {
                **data,
                "status": "running",
                "startedAt": now,
                "attempt": int(data.get("attempt", 0)) + 1,
                "leaseExpiresAt": lease_expires_at,
            }
            txn.set(path, updated)
            return BackgroundRun.model_validate(updated)

        return await self._fs.run_transaction(_txn)

    async def _finish(
        self,
        run_id: str,
        *,
        status: str,
        finished_at: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        output_ref: str | None = None,
        model: str | None = None,
        token_cost_estimate: float | None = None,
    ) -> None:
        path = _doc_path(run_id)
        ended = finished_at or self._now_iso()
        patch: dict[str, object | None] = {
            "status": status,
            "finishedAt": ended,
            # Releasing the lease on every terminal write keeps a crashed-then-
            # retried run from looking perpetually leased.
            "leaseExpiresAt": None,
        }
        if error_code is not None:
            patch["errorCode"] = error_code
        if error_message is not None:
            patch["errorMessage"] = error_message
        if output_ref is not None:
            patch["outputRef"] = output_ref
        if model is not None:
            patch["model"] = model
        if token_cost_estimate is not None:
            patch["tokenCostEstimate"] = token_cost_estimate

        async def _txn(txn: BgTransaction) -> None:
            snap = await txn.get(path)
            if not snap.exists:
                return
            txn.update(path, patch)

        await self._fs.run_transaction(_txn)

    async def mark_succeeded(
        self,
        run_id: str,
        *,
        output_ref: str | None = None,
        model: str | None = None,
        token_cost_estimate: float | None = None,
        finished_at: str | None = None,
    ) -> None:
        await self._finish(
            run_id,
            status="succeeded",
            output_ref=output_ref,
            model=model,
            token_cost_estimate=token_cost_estimate,
            finished_at=finished_at,
        )

    async def mark_skipped(
        self, run_id: str, *, error_code: str, finished_at: str | None = None
    ) -> None:
        """Opt-in / token / scope / consent / quota check failed. The executor
        returns HTTP 200 so Cloud Tasks does not retry (ADR §3)."""
        await self._finish(run_id, status="skipped", error_code=error_code, finished_at=finished_at)

    async def mark_terminal_failed(
        self,
        run_id: str,
        *,
        error_code: str,
        error_message: str | None = None,
        finished_at: str | None = None,
    ) -> None:
        await self._finish(
            run_id,
            status="terminal_failed",
            error_code=error_code,
            error_message=error_message,
            finished_at=finished_at,
        )

    async def mark_retryable_failed(
        self, run_id: str, *, error_code: str, finished_at: str | None = None
    ) -> None:
        """Transient infra error. The executor returns 5xx and relies on Cloud
        Tasks retry; the run becomes claimable again on the next delivery."""
        await self._finish(
            run_id, status="retryable_failed", error_code=error_code, finished_at=finished_at
        )


def create_background_run_store(
    *,
    firestore: BackgroundFirestore,
    now_iso: Callable[[], str] | None = None,
) -> BackgroundRunStore:
    return BackgroundRunStore(firestore=firestore, now_iso=now_iso)
