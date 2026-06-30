"""Unit tests for the background dispatcher tick (ADR 0001 §2, step 5a)."""

from __future__ import annotations

import pytest

from lifecoach_agent.background import ids
from lifecoach_agent.background.dispatcher import Dispatcher
from lifecoach_agent.background.tasks_client import TaskRequest
from lifecoach_agent.contracts.background import BackgroundSchedule
from lifecoach_agent.storage.background_runs import create_background_run_store
from lifecoach_agent.storage.background_schedules import create_background_schedule_store
from tests.unit.storage._bg_firestore import FakeBackgroundFirestore

pytestmark = pytest.mark.asyncio


class FakeTasksClient:
    def __init__(self, *, already_exists: bool = False) -> None:
        self.enqueued: list[TaskRequest] = []
        self._already_exists = already_exists

    async def enqueue(self, req: TaskRequest) -> bool:
        self.enqueued.append(req)
        return not self._already_exists


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
        "nextRunAt": "2026-05-15T08:00:00.000Z",
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-05-01T00:00:00.000Z",
    }
    base.update(overrides)
    return BackgroundSchedule.model_validate(base)


def _dispatcher(fs: FakeBackgroundFirestore, tasks: FakeTasksClient, now: str) -> Dispatcher:
    return Dispatcher(
        schedules=create_background_schedule_store(firestore=fs),  # type: ignore[arg-type]
        runs=create_background_run_store(firestore=fs),  # type: ignore[arg-type]
        tasks=tasks,
        agent_base_url="https://agent.run.app/",
        invoker_sa_email="background-invoker@p.iam.gserviceaccount.com",
        oidc_audience="https://agent.run.app",
        now_iso=lambda: now,
    )


async def test_tick_dispatches_due_schedule() -> None:
    fs = FakeBackgroundFirestore()
    store = create_background_schedule_store(firestore=fs)  # type: ignore[arg-type]
    await store.upsert(_schedule())
    tasks = FakeTasksClient()

    dispatched = await _dispatcher(fs, tasks, "2026-05-15T09:00:00.000Z").tick()

    assert dispatched == 1
    # Run record created (queued), deterministic id, correct window.
    run_id = ids.run_id("s1", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    run_doc = fs.docs[f"backgroundRuns/{run_id}"]
    assert run_doc["status"] == "queued"
    assert run_doc["scheduledFor"] == "2026-05-15T08:00:00.000Z"
    assert run_doc["inputWindowStart"] == "2026-05-14T08:00:00.000Z"
    assert run_doc["idempotencyKey"] == "s1:email_triage_daily:2026-05-15T08:00:00.000Z"

    # One task enqueued, payload is ids-only, targets the execute route.
    assert len(tasks.enqueued) == 1
    req = tasks.enqueued[0]
    assert req.url == f"https://agent.run.app/background/runs/{run_id}/execute"
    assert req.payload == {
        "runId": run_id,
        "scheduleId": "s1",
        "uid": "uid-1",
        "kind": "email_triage_daily",
        "scheduledFor": "2026-05-15T08:00:00.000Z",
    }
    assert "uid-1" not in req.task_id  # uid is hashed in the task id

    # Schedule advanced to the next 08:00 and lease cleared; outcome untouched.
    sched_doc = fs.docs["backgroundSchedules/s1"]
    assert sched_doc["nextRunAt"] == "2026-05-16T08:00:00.000Z"
    assert sched_doc.get("pendingRunId") is None
    assert sched_doc.get("leaseExpiresAt") is None
    assert "lastStatus" not in sched_doc  # dispatcher never sets run outcome


async def test_tick_no_due_schedules_returns_zero() -> None:
    fs = FakeBackgroundFirestore()
    store = create_background_schedule_store(firestore=fs)  # type: ignore[arg-type]
    await store.upsert(_schedule(nextRunAt="2026-05-20T08:00:00.000Z"))  # future
    tasks = FakeTasksClient()
    assert await _dispatcher(fs, tasks, "2026-05-15T09:00:00.000Z").tick() == 0
    assert tasks.enqueued == []


async def test_tick_skips_disabled() -> None:
    fs = FakeBackgroundFirestore()
    store = create_background_schedule_store(firestore=fs)  # type: ignore[arg-type]
    await store.upsert(_schedule(enabled=False))
    tasks = FakeTasksClient()
    assert await _dispatcher(fs, tasks, "2026-05-15T09:00:00.000Z").tick() == 0


async def test_tick_skips_when_valid_lease_held() -> None:
    # A prior tick is mid-enqueue (valid lease) → claim fails → no dispatch.
    fs = FakeBackgroundFirestore()
    store = create_background_schedule_store(firestore=fs)  # type: ignore[arg-type]
    await store.upsert(_schedule())
    fs.docs["backgroundSchedules/s1"]["pendingRunId"] = "other-run"
    fs.docs["backgroundSchedules/s1"]["leaseExpiresAt"] = "2026-05-15T09:05:00.000Z"
    tasks = FakeTasksClient()
    assert await _dispatcher(fs, tasks, "2026-05-15T09:00:00.000Z").tick() == 0
    assert tasks.enqueued == []


async def test_tick_is_idempotent_on_redispatch() -> None:
    # Simulate a crash after create+enqueue but before advance: lease expired,
    # nextRunAt still due. The next tick re-derives the same run id; create is
    # a no-op and the digest/task aren't duplicated.
    fs = FakeBackgroundFirestore()
    store = create_background_schedule_store(firestore=fs)  # type: ignore[arg-type]
    await store.upsert(_schedule())
    first = FakeTasksClient()
    await _dispatcher(fs, first, "2026-05-15T09:00:00.000Z").tick()

    # Roll the schedule back to "due, no lease" as if the advance never ran.
    fs.docs["backgroundSchedules/s1"]["nextRunAt"] = "2026-05-15T08:00:00.000Z"
    fs.docs["backgroundSchedules/s1"]["pendingRunId"] = None
    fs.docs["backgroundSchedules/s1"]["leaseExpiresAt"] = None
    run_id = ids.run_id("s1", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    run_before = dict(fs.docs[f"backgroundRuns/{run_id}"])

    second = FakeTasksClient()
    await _dispatcher(fs, second, "2026-05-15T09:00:00.000Z").tick()

    # Same run id, status not regressed by the re-create.
    assert fs.docs[f"backgroundRuns/{run_id}"]["status"] == run_before["status"]
    assert len([k for k in fs.docs if k.startswith("backgroundRuns/")]) == 1
