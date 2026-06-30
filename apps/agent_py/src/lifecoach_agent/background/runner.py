"""Background run executor — the `/background/runs/{runId}/execute` body (ADR 0001 §3/§5).

Orchestrates one idempotent run:

  claim_for_execution (lease)        — duplicate/in-flight delivery → no-op (200)
    → validate (BEFORE any external I/O): schedule enabled, Workspace connected,
      token usable, workflow registered → any failure ⇒ `skipped` + HTTP 200
      (Cloud Tasks must NOT retry a non-retryable condition, ADR §3)
    → run the workflow (reads + classifies; never mutates third-party state)
    → persist the digest + proposed actions, then mark_succeeded
    → BackgroundRetryableError ⇒ `retryable_failed` + 5xx (Cloud Tasks retries)
    → any other exception ⇒ `terminal_failed` + 200 (don't hammer the queue on a
      deterministic bug); the sanitized class goes to Cloud Logging, never the
      raw message to Firestore (ADR §Error sanitization).

The app owns every terminal state — Cloud Tasks is never a dead-letter.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from lifecoach_agent.background.ids import uid_hash
from lifecoach_agent.background.workflow import (
    BackgroundRetryableError,
    BackgroundRunContext,
    BackgroundWorkflow,
)
from lifecoach_agent.storage.background_notifications import BackgroundNotificationStore
from lifecoach_agent.storage.background_proposed_actions import BackgroundProposedActionStore
from lifecoach_agent.storage.background_runs import BackgroundRunStore
from lifecoach_agent.storage.background_schedules import BackgroundScheduleStore
from lifecoach_agent.storage.background_time import canonical_iso
from lifecoach_agent.storage.background_time import now_iso as _now_iso_default

_logger = logging.getLogger("lifecoach.background.runner")


@dataclass(frozen=True)
class ExecuteOutcome:
    """What the executor endpoint maps to an HTTP response."""

    status: str  # noop | skipped | succeeded | retryable_failed | terminal_failed
    http_status: int
    error_code: str | None = None


class _StoredToken(Protocol):
    scopes: list[str]


class _WorkspaceTokens(Protocol):
    """The slice of `WorkspaceTokensStore` the runner needs."""

    async def get(self, uid: str) -> _StoredToken | None: ...

    async def get_valid_access_token(self, uid: str) -> str: ...


class BackgroundRunner:
    def __init__(
        self,
        *,
        runs: BackgroundRunStore,
        schedules: BackgroundScheduleStore,
        notifications: BackgroundNotificationStore,
        proposed_actions: BackgroundProposedActionStore,
        workspace_tokens: _WorkspaceTokens,
        workflows: Mapping[str, BackgroundWorkflow],
        lease_ttl_seconds: int = 600,
        max_attempts: int = 5,
        now_iso: Callable[[], str] | None = None,
    ) -> None:
        self._runs = runs
        self._schedules = schedules
        self._notifications = notifications
        self._actions = proposed_actions
        self._tokens = workspace_tokens
        self._workflows = workflows
        self._lease_ttl_seconds = lease_ttl_seconds
        # Matches the Cloud Tasks queue retry_config.max_attempts; the runner
        # marks the final delivery terminal so the run never lags non-terminal
        # after Cloud Tasks gives up (ADR app-owned-terminal-state).
        self._max_attempts = max_attempts
        self._now_iso = now_iso or _now_iso_default

    def _lease_until(self, now: str) -> str:
        base = datetime.fromisoformat(now.replace("Z", "+00:00")).astimezone(UTC)
        return canonical_iso((base + timedelta(seconds=self._lease_ttl_seconds)).isoformat())

    async def execute(
        self,
        *,
        run_id: str,
        schedule_id: str,
        uid: str,
        kind: str,
    ) -> ExecuteOutcome:
        now = self._now_iso()
        claimed = await self._runs.claim_for_execution(
            run_id=run_id, lease_expires_at=self._lease_until(now), now_iso=now
        )
        if claimed is None:
            # Duplicate delivery for an in-flight (live lease) or terminal run —
            # another worker owns it. Replay is a no-op; digests never double.
            return ExecuteOutcome("noop", 200)

        # --- validate before any external I/O (ADR §3) --------------------
        schedule = await self._schedules.get(schedule_id)
        if schedule is None or not schedule.enabled:
            return await self._skip(run_id, "SCHEDULE_DISABLED")

        token = await self._tokens.get(uid)
        if token is None:
            return await self._skip(run_id, "WORKSPACE_DISCONNECTED")

        workflow = self._workflows.get(kind)
        if workflow is None:
            return await self._skip(run_id, "WORKFLOW_NOT_REGISTERED")

        # Granular consent / scope rollout can leave a connected token missing
        # the scope a workflow needs — skip (non-retryable) before any Gmail
        # call rather than failing mid-run (Codex #203).
        required = set(getattr(workflow, "required_scopes", ()) or ())
        if not required.issubset(set(token.scopes)):
            return await self._skip(run_id, "WORKSPACE_SCOPE_MISSING")

        try:
            access_token = await self._tokens.get_valid_access_token(uid)
        except Exception:  # noqa: BLE001 — revoked/refresh failure → skip, not retry
            return await self._skip(run_id, "WORKSPACE_TOKEN_REVOKED")

        ctx = BackgroundRunContext(
            run=claimed,
            schedule=schedule,
            workspace_access_token=access_token,
            now_iso=self._now_iso(),
        )

        # --- run ---------------------------------------------------------
        try:
            result = await workflow.run(ctx)
        except BackgroundRetryableError as e:
            return await self._handle_retryable(run_id, claimed.attempt, e.error_code)
        except Exception as e:  # noqa: BLE001 — deterministic failure → terminal, no retry
            # Sanitized class only to logs; raw message NEVER to Firestore (ADR).
            _logger.error(
                "background_workflow_error",
                extra={"uid_hash": uid_hash(uid), "kind": kind, "error_class": type(e).__name__},
            )
            await self._runs.mark_terminal_failed(
                run_id, error_code="WORKFLOW_ERROR", finished_at=self._now_iso()
            )
            return ExecuteOutcome("terminal_failed", 200, "WORKFLOW_ERROR")

        # --- persist (must not ack a retry while the lease is still live) --
        # If a Firestore write fails here the run is still `running` with a live
        # lease; acking (200) would let Cloud Tasks delete the task and strand
        # the run. Mark it retryable (clears the lease) and return 5xx so the
        # next delivery re-claims and the create-if-absent writes are idempotent
        # (Codex #203 P1).
        try:
            for action in result.proposed_actions:
                await self._actions.create(action)
            output_ref: str | None = None
            if result.notification is not None:
                await self._notifications.create(result.notification)
                output_ref = result.notification.id
            await self._runs.mark_succeeded(
                run_id,
                output_ref=output_ref,
                model=result.model,
                token_cost_estimate=result.token_cost_estimate,
                finished_at=self._now_iso(),
            )
        except Exception as e:  # noqa: BLE001 — transient storage failure → retry
            _logger.error(
                "background_persist_error",
                extra={"uid_hash": uid_hash(uid), "kind": kind, "error_class": type(e).__name__},
            )
            return await self._handle_retryable(run_id, claimed.attempt, "ARTIFACT_WRITE_FAILED")
        return ExecuteOutcome("succeeded", 200)

    async def _handle_retryable(self, run_id: str, attempt: int, error_code: str) -> ExecuteOutcome:
        """Transient failure. On the final delivery (attempt ≥ max_attempts)
        record a terminal state + 200 so the run doesn't linger non-terminal
        after Cloud Tasks gives up; otherwise `retryable_failed` + 5xx to retry."""
        if attempt >= self._max_attempts:
            await self._runs.mark_terminal_failed(
                run_id, error_code=error_code, finished_at=self._now_iso()
            )
            return ExecuteOutcome("terminal_failed", 200, error_code)
        await self._runs.mark_retryable_failed(
            run_id, error_code=error_code, finished_at=self._now_iso()
        )
        return ExecuteOutcome("retryable_failed", 503, error_code)

    async def _skip(self, run_id: str, error_code: str) -> ExecuteOutcome:
        await self._runs.mark_skipped(run_id, error_code=error_code, finished_at=self._now_iso())
        return ExecuteOutcome("skipped", 200, error_code)
