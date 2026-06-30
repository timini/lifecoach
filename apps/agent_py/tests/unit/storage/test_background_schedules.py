"""Unit tests for the `backgroundSchedules` store (ADR 0001 step 2a) —
bounded due-query + transactional lease, against the in-memory fake."""

from __future__ import annotations

import pytest

from lifecoach_agent.contracts.background import BackgroundSchedule
from lifecoach_agent.storage.background_schedules import (
    BackgroundScheduleStore,
    create_background_schedule_store,
)
from tests.unit.storage._bg_firestore import FakeBackgroundFirestore

pytestmark = pytest.mark.asyncio


def _schedule(sid: str, *, enabled: bool = True, next_run_at: str) -> BackgroundSchedule:
    return BackgroundSchedule.model_validate(
        {
            "id": sid,
            "uid": "uid-1",
            "kind": "email_triage_daily",
            "enabled": enabled,
            "timezone": "Europe/London",
            "cadence": {"type": "daily", "localTime": "08:00"},
            "lookbackWindow": "1d",
            "consentVersion": "v1",
            "permittedActions": {
                "archiveNoise": "after_confirmation",
                "createTasks": "never",
                "createCalendarEvents": "never",
            },
            "notify": {"inApp": True, "email": False, "chatSummaryOnNextOpen": True},
            "nextRunAt": next_run_at,
            "createdAt": "2026-05-01T00:00:00.000Z",
            "updatedAt": "2026-05-01T00:00:00.000Z",
        }
    )


def _store(fs: FakeBackgroundFirestore) -> BackgroundScheduleStore:
    return create_background_schedule_store(firestore=fs)  # type: ignore[arg-type]


async def test_upsert_then_get_round_trips() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    sched = _schedule("s1", next_run_at="2026-05-15T07:00:00.000Z")
    await store.upsert(sched)
    got = await store.get("s1")
    assert got == sched


async def test_get_missing_returns_none() -> None:
    assert await _store(FakeBackgroundFirestore()).get("nope") is None


async def test_get_strips_operational_lease_fields() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="2026-05-15T07:00:00.000Z"))
    # An in-flight lease on the doc must not break contract validation.
    fs.docs["backgroundSchedules/s1"]["pendingRunId"] = "run-x"
    fs.docs["backgroundSchedules/s1"]["leaseExpiresAt"] = "2026-05-15T07:05:00.000Z"
    got = await store.get("s1")
    assert got is not None and got.id == "s1"


async def test_upsert_preserves_in_flight_lease() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="2026-05-15T07:00:00.000Z"))
    fs.docs["backgroundSchedules/s1"]["pendingRunId"] = "run-x"
    fs.docs["backgroundSchedules/s1"]["leaseExpiresAt"] = "2026-05-15T07:05:00.000Z"
    # A settings-UI re-save must not clobber a lease a concurrent tick holds.
    await store.upsert(_schedule("s1", next_run_at="2026-05-16T07:00:00.000Z"))
    assert fs.docs["backgroundSchedules/s1"]["pendingRunId"] == "run-x"
    assert fs.docs["backgroundSchedules/s1"]["nextRunAt"] == "2026-05-16T07:00:00.000Z"


async def test_query_due_filters_orders_and_bounds() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("late", next_run_at="2026-05-15T09:00:00.000Z"))
    await store.upsert(_schedule("early", next_run_at="2026-05-15T06:00:00.000Z"))
    await store.upsert(_schedule("mid", next_run_at="2026-05-15T07:30:00.000Z"))
    await store.upsert(_schedule("future", next_run_at="2026-05-15T23:00:00.000Z"))
    await store.upsert(_schedule("off", enabled=False, next_run_at="2026-05-15T06:00:00.000Z"))

    due = await store.query_due(limit=10, now_iso="2026-05-15T08:00:00.000Z")
    # disabled excluded; future excluded; oldest-first ordering.
    assert [s.id for s in due] == ["early", "mid"]


async def test_query_due_respects_limit() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    for i in range(5):
        await store.upsert(_schedule(f"s{i}", next_run_at=f"2026-05-15T0{i}:00:00.000Z"))
    due = await store.query_due(limit=2, now_iso="2026-05-15T09:00:00.000Z")
    assert [s.id for s in due] == ["s0", "s1"]


async def test_claim_lease_succeeds_when_unleased() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="2026-05-15T07:00:00.000Z"))
    ok = await store.claim_lease(
        schedule_id="s1",
        run_id="run-1",
        lease_expires_at="2026-05-15T08:05:00.000Z",
        now_iso="2026-05-15T08:00:00.000Z",
    )
    assert ok is True
    assert fs.docs["backgroundSchedules/s1"]["pendingRunId"] == "run-1"


async def test_claim_lease_blocked_by_valid_lease() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="2026-05-15T07:00:00.000Z"))
    fs.docs["backgroundSchedules/s1"]["pendingRunId"] = "run-prior"
    fs.docs["backgroundSchedules/s1"]["leaseExpiresAt"] = "2026-05-15T08:05:00.000Z"
    ok = await store.claim_lease(
        schedule_id="s1",
        run_id="run-2",
        lease_expires_at="2026-05-15T08:10:00.000Z",
        now_iso="2026-05-15T08:00:00.000Z",
    )
    assert ok is False
    assert fs.docs["backgroundSchedules/s1"]["pendingRunId"] == "run-prior"


async def test_claim_lease_succeeds_when_prior_lease_expired() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="2026-05-15T07:00:00.000Z"))
    fs.docs["backgroundSchedules/s1"]["pendingRunId"] = "run-stale"
    fs.docs["backgroundSchedules/s1"]["leaseExpiresAt"] = "2026-05-15T07:59:00.000Z"
    ok = await store.claim_lease(
        schedule_id="s1",
        run_id="run-2",
        lease_expires_at="2026-05-15T08:05:00.000Z",
        now_iso="2026-05-15T08:00:00.000Z",
    )
    assert ok is True
    assert fs.docs["backgroundSchedules/s1"]["pendingRunId"] == "run-2"


async def test_claim_lease_false_when_schedule_missing() -> None:
    ok = await _store(FakeBackgroundFirestore()).claim_lease(
        schedule_id="ghost",
        run_id="run-1",
        lease_expires_at="2026-05-15T08:05:00.000Z",
        now_iso="2026-05-15T08:00:00.000Z",
    )
    assert ok is False


async def test_release_lease_and_advance() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="2026-05-15T07:00:00.000Z"))
    await store.claim_lease(
        schedule_id="s1",
        run_id="run-1",
        lease_expires_at="2026-05-15T08:05:00.000Z",
        now_iso="2026-05-15T08:00:00.000Z",
    )
    await store.release_lease_and_advance(
        schedule_id="s1",
        next_run_at="2026-05-16T07:00:00.000Z",
        last_status="ok",
        last_run_at="2026-05-15T08:00:01.000Z",
    )
    doc = fs.docs["backgroundSchedules/s1"]
    assert doc["pendingRunId"] is None
    assert doc["leaseExpiresAt"] is None
    assert doc["nextRunAt"] == "2026-05-16T07:00:00.000Z"
    assert doc["lastStatus"] == "ok"
    assert doc["lastRunAt"] == "2026-05-15T08:00:01.000Z"


async def test_release_lease_noop_when_missing() -> None:
    # Must not resurrect a deleted schedule.
    fs = FakeBackgroundFirestore()
    await _store(fs).release_lease_and_advance(
        schedule_id="ghost", next_run_at="2026-05-16T07:00:00.000Z", last_status="ok"
    )
    assert "backgroundSchedules/ghost" not in fs.docs


async def test_get_empty_doc_returns_none() -> None:
    # A doc that exists but carries no data must not crash validation.
    fs = FakeBackgroundFirestore()
    fs.docs["backgroundSchedules/empty"] = {}
    assert await _store(fs).get("empty") is None


async def test_upsert_over_unleased_existing_doc() -> None:
    # Re-save where the prior doc holds no lease exercises the "no lease to
    # preserve" branch.
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="2026-05-15T07:00:00.000Z"))
    await store.upsert(_schedule("s1", next_run_at="2026-05-16T07:00:00.000Z"))
    assert "pendingRunId" not in fs.docs["backgroundSchedules/s1"]
    assert fs.docs["backgroundSchedules/s1"]["nextRunAt"] == "2026-05-16T07:00:00.000Z"


async def test_default_now_iso_is_used_when_omitted() -> None:
    # Exercises the injected-clock default path (no now_iso passed).
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.upsert(_schedule("s1", next_run_at="1970-01-01T00:00:00.000Z"))
    due = await store.query_due(limit=10)
    assert [s.id for s in due] == ["s1"]
