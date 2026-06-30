"""Unit tests for the background run executor (ADR 0001 §3/§5, step 5b-ii)."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from lifecoach_agent.background.runner import BackgroundRunner
from lifecoach_agent.background.workflow import (
    BackgroundRetryableError,
    BackgroundRunContext,
    BackgroundRunResult,
)
from lifecoach_agent.contracts.background import (
    BackgroundNotification,
    BackgroundProposedAction,
    BackgroundRun,
    BackgroundSchedule,
)
from lifecoach_agent.storage.background_notifications import create_background_notification_store
from lifecoach_agent.storage.background_proposed_actions import (
    create_background_proposed_action_store,
)
from lifecoach_agent.storage.background_runs import create_background_run_store
from lifecoach_agent.storage.background_schedules import create_background_schedule_store
from tests.unit.storage._bg_firestore import FakeBackgroundFirestore

pytestmark = pytest.mark.asyncio

_NOW = "2026-05-15T08:00:10.000Z"


def _schedule(**overrides: object) -> BackgroundSchedule:
    base: dict[str, object] = {
        "id": "s1",
        "uid": "uid-1",
        "kind": "email_triage_daily",
        "enabled": True,
        "timezone": "UTC",
        "cadence": {"type": "daily", "localTime": "08:00"},
        "lookbackWindow": "1d",
        "consentVersion": "v1",
        "permittedActions": {
            "archiveNoise": "never",
            "createTasks": "never",
            "createCalendarEvents": "never",
        },
        "notify": {"inApp": True, "email": False, "chatSummaryOnNextOpen": True},
        "nextRunAt": "2026-05-16T08:00:00.000Z",
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-05-01T00:00:00.000Z",
    }
    base.update(overrides)
    return BackgroundSchedule.model_validate(base)


def _run(rid: str = "run-1", status: str = "queued") -> BackgroundRun:
    return BackgroundRun.model_validate(
        {
            "id": rid,
            "uid": "uid-1",
            "scheduleId": "s1",
            "kind": "email_triage_daily",
            "status": status,
            "idempotencyKey": "s1:email_triage_daily:2026-05-15T08:00:00.000Z",
            "scheduledFor": "2026-05-15T08:00:00.000Z",
            "inputWindowStart": "2026-05-14T08:00:00.000Z",
            "inputWindowEnd": "2026-05-15T08:00:00.000Z",
            "attempt": 0,
            "createdAt": "2026-05-15T07:55:00.000Z",
        }
    )


def _notification() -> BackgroundNotification:
    return BackgroundNotification.model_validate(
        {
            "id": "n1",
            "uid": "uid-1",
            "runId": "run-1",
            "kind": "email_triage_daily",
            "status": "unread",
            "title": "1 action",
            "summary": "1 action since yesterday.",
            "items": [],
            "proposedActions": ["a1"],
            "createdAt": _NOW,
        }
    )


def _action() -> BackgroundProposedAction:
    return BackgroundProposedAction.model_validate(
        {
            "id": "a1",
            "uid": "uid-1",
            "runId": "run-1",
            "type": "archive_message",
            "status": "proposed",
            "sourceMessageIds": ["m1"],
            "summary": "Archive newsletter",
            "createdAt": _NOW,
        }
    )


@dataclass
class _StoredToken:
    scopes: list[str]


class _FakeTokens:
    def __init__(
        self, *, present: bool = True, revoked: bool = False, scopes: list[str] | None = None
    ) -> None:
        self._present = present
        self._revoked = revoked
        self._scopes = scopes if scopes is not None else ["gmail.readonly"]

    async def get(self, uid: str) -> _StoredToken | None:
        return _StoredToken(scopes=self._scopes) if self._present else None

    async def get_valid_access_token(self, uid: str) -> str:
        if self._revoked:
            raise RuntimeError("refresh failed")
        return "ya29.fake-access-token"


class _FakeWorkflow:
    name = "email_triage_daily"
    required_scopes: tuple[str, ...] = ()

    def __init__(
        self,
        *,
        result: BackgroundRunResult | None = None,
        raises: Exception | None = None,
        required_scopes: tuple[str, ...] = (),
    ):
        self._result = result if result is not None else BackgroundRunResult()
        self._raises = raises
        self.required_scopes = required_scopes
        self.calls = 0
        self.last_ctx: BackgroundRunContext | None = None

    async def run(self, ctx: BackgroundRunContext) -> BackgroundRunResult:
        self.calls += 1
        self.last_ctx = ctx
        if self._raises is not None:
            raise self._raises
        return self._result


def _runner(
    fs: FakeBackgroundFirestore,
    *,
    tokens: _FakeTokens | None = None,
    workflow: _FakeWorkflow | None = None,
    register: bool = True,
    max_attempts: int = 5,
    notifications: object | None = None,
) -> BackgroundRunner:
    wf = workflow or _FakeWorkflow()
    return BackgroundRunner(
        runs=create_background_run_store(firestore=fs),  # type: ignore[arg-type]
        schedules=create_background_schedule_store(firestore=fs),  # type: ignore[arg-type]
        notifications=notifications or create_background_notification_store(firestore=fs),  # type: ignore[arg-type]
        proposed_actions=create_background_proposed_action_store(firestore=fs),  # type: ignore[arg-type]
        workspace_tokens=tokens or _FakeTokens(),  # type: ignore[arg-type]
        workflows={"email_triage_daily": wf} if register else {},
        max_attempts=max_attempts,
        now_iso=lambda: _NOW,
    )


async def _seed(fs: FakeBackgroundFirestore, *, run_status: str = "queued") -> None:
    await create_background_schedule_store(firestore=fs).upsert(_schedule())  # type: ignore[arg-type]
    await create_background_run_store(firestore=fs).create(_run(status=run_status))  # type: ignore[arg-type]


async def _execute(runner: BackgroundRunner) -> object:
    return await runner.execute(
        run_id="run-1", schedule_id="s1", uid="uid-1", kind="email_triage_daily"
    )


async def test_succeeded_persists_artifacts_and_marks_run() -> None:
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    wf = _FakeWorkflow(
        result=BackgroundRunResult(
            notification=_notification(),
            proposed_actions=[_action()],
            model="gemini-flash-lite-latest",
            token_cost_estimate=0.0009,
        )
    )
    outcome = await _execute(_runner(fs, workflow=wf))

    assert (outcome.status, outcome.http_status) == ("succeeded", 200)
    assert wf.calls == 1
    # Token reached the workflow context but never the run/notification records.
    assert wf.last_ctx is not None and wf.last_ctx.workspace_access_token.startswith("ya29.")
    assert fs.docs["backgroundNotifications/n1"]["title"] == "1 action"
    assert fs.docs["backgroundProposedActions/a1"]["status"] == "proposed"
    run_doc = fs.docs["backgroundRuns/run-1"]
    assert run_doc["status"] == "succeeded"
    assert run_doc["outputRef"] == "n1"
    assert run_doc["model"] == "gemini-flash-lite-latest"


async def test_skip_when_schedule_disabled() -> None:
    fs = FakeBackgroundFirestore()
    await create_background_schedule_store(firestore=fs).upsert(_schedule(enabled=False))  # type: ignore[arg-type]
    await create_background_run_store(firestore=fs).create(_run())  # type: ignore[arg-type]
    outcome = await _execute(_runner(fs))
    assert (outcome.status, outcome.http_status, outcome.error_code) == (
        "skipped",
        200,
        "SCHEDULE_DISABLED",
    )
    assert fs.docs["backgroundRuns/run-1"]["status"] == "skipped"


async def test_skip_when_workspace_disconnected() -> None:
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    outcome = await _execute(_runner(fs, tokens=_FakeTokens(present=False)))
    assert outcome.error_code == "WORKSPACE_DISCONNECTED"
    assert fs.docs["backgroundRuns/run-1"]["status"] == "skipped"


async def test_skip_when_token_revoked() -> None:
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    outcome = await _execute(_runner(fs, tokens=_FakeTokens(revoked=True)))
    assert outcome.error_code == "WORKSPACE_TOKEN_REVOKED"


async def test_skip_when_workflow_not_registered() -> None:
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    outcome = await _execute(_runner(fs, register=False))
    assert outcome.error_code == "WORKFLOW_NOT_REGISTERED"


async def test_retryable_error_returns_5xx() -> None:
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    wf = _FakeWorkflow(raises=BackgroundRetryableError("GMAIL_UNAVAILABLE"))
    outcome = await _execute(_runner(fs, workflow=wf))
    assert (outcome.status, outcome.http_status, outcome.error_code) == (
        "retryable_failed",
        503,
        "GMAIL_UNAVAILABLE",
    )
    assert fs.docs["backgroundRuns/run-1"]["status"] == "retryable_failed"


async def test_unknown_error_is_terminal_and_does_not_retry() -> None:
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    wf = _FakeWorkflow(raises=ValueError("boom: ya29.secret-should-not-leak"))
    outcome = await _execute(_runner(fs, workflow=wf))
    assert (outcome.status, outcome.http_status, outcome.error_code) == (
        "terminal_failed",
        200,
        "WORKFLOW_ERROR",
    )
    doc = fs.docs["backgroundRuns/run-1"]
    assert doc["status"] == "terminal_failed"
    # Raw exception text is NEVER persisted to Firestore (ADR §Error sanitization).
    assert "errorMessage" not in doc
    assert doc["errorCode"] == "WORKFLOW_ERROR"


async def test_skip_when_required_scope_missing() -> None:
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    wf = _FakeWorkflow(required_scopes=("gmail.readonly",))
    # Token connected but missing the Gmail scope (granular consent).
    outcome = await _execute(
        _runner(fs, workflow=wf, tokens=_FakeTokens(scopes=["calendar.readonly"]))
    )
    assert outcome.error_code == "WORKSPACE_SCOPE_MISSING"
    assert wf.calls == 0
    assert fs.docs["backgroundRuns/run-1"]["status"] == "skipped"


async def test_retry_exhaustion_marks_terminal_not_stuck() -> None:
    # On the final delivery a still-transient failure becomes terminal (+200) so
    # the run isn't left non-terminal after Cloud Tasks gives up (Codex #203).
    fs = FakeBackgroundFirestore()
    await _seed(fs)
    wf = _FakeWorkflow(raises=BackgroundRetryableError("GMAIL_UNAVAILABLE"))
    outcome = await _execute(_runner(fs, workflow=wf, max_attempts=1))
    assert (outcome.status, outcome.http_status, outcome.error_code) == (
        "terminal_failed",
        200,
        "GMAIL_UNAVAILABLE",
    )
    assert fs.docs["backgroundRuns/run-1"]["status"] == "terminal_failed"


async def test_persist_failure_marks_retryable_not_acked() -> None:
    # A storage failure AFTER the workflow returned must not ack the task while
    # the run is still running with a live lease — mark retryable + 5xx so the
    # next delivery re-claims (Codex #203 P1).
    class _FailingNotifications:
        async def create(self, notification: object) -> bool:
            raise RuntimeError("firestore unavailable")

    fs = FakeBackgroundFirestore()
    await _seed(fs)
    wf = _FakeWorkflow(result=BackgroundRunResult(notification=_notification()))
    outcome = await _execute(_runner(fs, workflow=wf, notifications=_FailingNotifications()))
    assert (outcome.status, outcome.http_status, outcome.error_code) == (
        "retryable_failed",
        503,
        "ARTIFACT_WRITE_FAILED",
    )
    doc = fs.docs["backgroundRuns/run-1"]
    assert doc["status"] == "retryable_failed"
    # Lease cleared so the next delivery can re-claim (not stuck running).
    assert "leaseExpiresAt" not in doc


async def test_duplicate_delivery_is_noop() -> None:
    # A run already terminal (succeeded) → claim returns None → no-op, no skip.
    fs = FakeBackgroundFirestore()
    await create_background_schedule_store(firestore=fs).upsert(_schedule())  # type: ignore[arg-type]
    await create_background_run_store(firestore=fs).create(_run(status="succeeded"))  # type: ignore[arg-type]
    wf = _FakeWorkflow()
    outcome = await _execute(_runner(fs, workflow=wf))
    assert (outcome.status, outcome.http_status) == ("noop", 200)
    assert wf.calls == 0
    assert fs.docs["backgroundRuns/run-1"]["status"] == "succeeded"
