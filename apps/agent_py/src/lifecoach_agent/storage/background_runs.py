"""Firestore-backed store for `backgroundRuns` (ADR 0001, step 2b).

The app owns terminal state — Cloud Tasks is at-least-once and may delete
tasks that exhaust retries, so every terminal outcome is persisted here,
never left to the queue as a dead-letter (ADR §3).

Three responsibilities:
- **lease-claim on execute** (`claim_for_execution`): a transaction that
  flips a run from `queued`/`retryable_failed`, or a `running` run whose
  lease has **expired** (a crashed worker), to `running`. A duplicate Cloud
  Task delivery for a run that's still `running` (unexpired lease) or terminal
  returns None — the replay is a no-op, so digests/actions never duplicate.
- **idempotency-key dedupe** (`find_by_idempotency_key`): the second dedupe
  layer behind the schedule lease + deterministic task ID.
- **terminal-failure persistence** (`mark_*`): stable `errorCode` only; raw
  third-party exception text is never stored — a debugging excerpt belongs in
  Cloud Logging, not Firestore (ADR §Error sanitization).
"""

from __future__ import annotations

from collections.abc import Callable

from lifecoach_agent.contracts.background import BackgroundRun
from lifecoach_agent.storage.background_firestore import (
    DELETE_FIELD,
    BackgroundFirestore,
    BgTransaction,
)
from lifecoach_agent.storage.background_time import canonical_iso
from lifecoach_agent.storage.background_time import now_iso as _now_iso_default

_COLLECTION = "backgroundRuns"

# A run in one of these states may always be claimed for (re-)execution. A
# `running` run is *also* claimable, but only once its lease has expired (see
# claim_for_execution) — that's the crashed-worker recovery path.
_CLAIMABLE = ("queued", "retryable_failed")


def _doc_path(run_id: str) -> str:
    return f"{_COLLECTION}/{run_id}"


class BackgroundRunStore:
    def __init__(
        self,
        *,
        firestore: BackgroundFirestore,
        now_iso: Callable[[], str] | None = None,
    ) -> None:
        self._fs = firestore
        self._now_iso = now_iso or _now_iso_default

    async def create(self, run: BackgroundRun) -> bool:
        """Create the run record (status `queued`). Refuses to overwrite an
        existing run so a retried/slow dispatcher can't regress a `running`/
        terminal run back to `queued` (PR #194 review). Returns True if
        created, False if a run with this id already exists."""
        path = _doc_path(run.id)
        doc = run.model_dump(exclude_none=True)

        async def _txn(txn: BgTransaction) -> bool:
            existing = await txn.get(path)
            if existing.exists:
                return False
            txn.set(path, doc)
            return True

        return await self._fs.run_transaction(_txn)

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
        """Atomically claim a run for execution. Claims a `queued`/
        `retryable_failed` run, or a `running` run whose lease has expired (the
        worker crashed before writing terminal state — the expired lease is the
        only recovery signal). Returns None for a missing run or one that's
        still `running` with a live lease, or terminal (a duplicate delivery —
        the executor must treat None as 'someone else has this')."""
        now = canonical_iso(now_iso) if now_iso else self._now_iso()
        lease_until = canonical_iso(lease_expires_at)
        path = _doc_path(run_id)

        async def _txn(txn: BgTransaction) -> BackgroundRun | None:
            snap = await txn.get(path)
            if not snap.exists:
                return None
            data = snap.data() or {}
            status = data.get("status")
            if status not in _CLAIMABLE and not _running_lease_expired(status, data, now):
                return None
            updated = {
                **data,
                "status": "running",
                "startedAt": now,
                "attempt": int(data.get("attempt", 0)) + 1,
                "leaseExpiresAt": lease_until,
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
        clear_error: bool = False,
        output_ref: str | None = None,
        model: str | None = None,
        token_cost_estimate: float | None = None,
    ) -> None:
        path = _doc_path(run_id)
        ended = canonical_iso(finished_at) if finished_at else self._now_iso()
        # leaseExpiresAt is omit-only in the contract → DELETE, never null. This
        # also stops a crashed-then-retried run looking perpetually leased.
        patch: dict[str, object] = {
            "status": status,
            "finishedAt": ended,
            "leaseExpiresAt": DELETE_FIELD,
        }
        if clear_error:
            # A run that previously failed then succeeded must not keep stale
            # error metadata on the terminal record.
            patch["errorCode"] = DELETE_FIELD
            patch["errorMessage"] = DELETE_FIELD
        if error_code is not None:
            patch["errorCode"] = error_code
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
            clear_error=True,
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
        self, run_id: str, *, error_code: str, finished_at: str | None = None
    ) -> None:
        """Retries exhausted / non-retryable. Only a stable `errorCode` is
        persisted; any free-text excerpt goes to Cloud Logging, not Firestore."""
        await self._finish(
            run_id, status="terminal_failed", error_code=error_code, finished_at=finished_at
        )

    async def mark_retryable_failed(
        self, run_id: str, *, error_code: str, finished_at: str | None = None
    ) -> None:
        """Transient infra error. The executor returns 5xx and relies on Cloud
        Tasks retry; the run becomes claimable again on the next delivery."""
        await self._finish(
            run_id, status="retryable_failed", error_code=error_code, finished_at=finished_at
        )


def _running_lease_expired(status: object, data: dict[str, object], now: str) -> bool:
    """True for a `running` run whose lease is missing or already elapsed —
    the crashed-worker recovery case."""
    if status != "running":
        return False
    expires = data.get("leaseExpiresAt")
    return not isinstance(expires, str) or expires <= now


def create_background_run_store(
    *,
    firestore: BackgroundFirestore,
    now_iso: Callable[[], str] | None = None,
) -> BackgroundRunStore:
    return BackgroundRunStore(firestore=firestore, now_iso=now_iso)
