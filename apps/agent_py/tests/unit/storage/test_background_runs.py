"""Unit tests for the `backgroundRuns` store (ADR 0001 step 2b) —
execute-lease claim, idempotency dedupe, terminal-failure persistence."""

from __future__ import annotations

import pytest

from lifecoach_agent.contracts.background import BackgroundRun
from lifecoach_agent.storage.background_runs import (
    BackgroundRunStore,
    create_background_run_store,
)
from tests.unit.storage._bg_firestore import FakeBackgroundFirestore

pytestmark = pytest.mark.asyncio


def _run(
    rid: str, *, status: str = "queued", attempt: int = 0, key: str | None = None
) -> BackgroundRun:
    return BackgroundRun.model_validate(
        {
            "id": rid,
            "uid": "uid-1",
            "scheduleId": "s1",
            "kind": "email_triage_daily",
            "status": status,
            "idempotencyKey": key or f"s1:email_triage_daily:2026-05-15T08:00:00Z::{rid}",
            "scheduledFor": "2026-05-15T08:00:00.000Z",
            "inputWindowStart": "2026-05-14T08:00:00.000Z",
            "inputWindowEnd": "2026-05-15T08:00:00.000Z",
            "attempt": attempt,
            "createdAt": "2026-05-15T07:55:00.000Z",
        }
    )


def _store(fs: FakeBackgroundFirestore) -> BackgroundRunStore:
    return create_background_run_store(firestore=fs)  # type: ignore[arg-type]


async def test_create_then_get_round_trips() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    run = _run("run-1")
    await store.create(run)
    assert await store.get("run-1") == run


async def test_get_missing_returns_none() -> None:
    assert await _store(FakeBackgroundFirestore()).get("nope") is None


async def test_get_empty_doc_returns_none() -> None:
    fs = FakeBackgroundFirestore()
    fs.docs["backgroundRuns/empty"] = {}
    assert await _store(fs).get("empty") is None


async def test_find_by_idempotency_key() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", key="dup-key"))
    found = await store.find_by_idempotency_key("dup-key")
    assert found is not None and found.id == "run-1"
    assert await store.find_by_idempotency_key("other") is None


async def test_claim_for_execution_from_queued() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1"))
    claimed = await store.claim_for_execution(
        run_id="run-1",
        lease_expires_at="2026-05-15T08:05:00.000Z",
        now_iso="2026-05-15T08:00:00.000Z",
    )
    assert claimed is not None
    assert claimed.status == "running"
    assert claimed.attempt == 1
    assert claimed.startedAt == "2026-05-15T08:00:00.000Z"
    assert fs.docs["backgroundRuns/run-1"]["leaseExpiresAt"] == "2026-05-15T08:05:00.000Z"


async def test_claim_for_execution_from_retryable_failed() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", status="retryable_failed", attempt=1))
    claimed = await store.claim_for_execution(
        run_id="run-1",
        lease_expires_at="2026-05-15T08:10:00.000Z",
        now_iso="2026-05-15T08:05:00.000Z",
    )
    assert claimed is not None and claimed.attempt == 2


async def test_claim_for_execution_noop_when_running() -> None:
    # Duplicate Cloud Task delivery for an in-flight run must not re-run it.
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", status="running", attempt=1))
    assert (
        await store.claim_for_execution(run_id="run-1", lease_expires_at="2026-05-15T08:10:00.000Z")
        is None
    )


async def test_claim_for_execution_noop_when_terminal() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", status="succeeded", attempt=1))
    assert (
        await store.claim_for_execution(run_id="run-1", lease_expires_at="2026-05-15T08:10:00.000Z")
        is None
    )


async def test_claim_for_execution_noop_when_missing() -> None:
    assert (
        await _store(FakeBackgroundFirestore()).claim_for_execution(
            run_id="ghost", lease_expires_at="2026-05-15T08:10:00.000Z"
        )
        is None
    )


async def test_mark_succeeded_persists_output_and_clears_lease() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", status="running"))
    fs.docs["backgroundRuns/run-1"]["leaseExpiresAt"] = "2026-05-15T08:05:00.000Z"
    await store.mark_succeeded(
        "run-1",
        output_ref="note_1",
        model="gemini-flash-lite-latest",
        token_cost_estimate=0.0012,
        finished_at="2026-05-15T08:00:05.000Z",
    )
    doc = fs.docs["backgroundRuns/run-1"]
    assert doc["status"] == "succeeded"
    assert doc["finishedAt"] == "2026-05-15T08:00:05.000Z"
    assert doc["outputRef"] == "note_1"
    assert doc["model"] == "gemini-flash-lite-latest"
    assert doc["tokenCostEstimate"] == 0.0012
    assert doc["leaseExpiresAt"] is None


async def test_mark_skipped() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1"))
    await store.mark_skipped("run-1", error_code="WORKSPACE_DISCONNECTED")
    doc = fs.docs["backgroundRuns/run-1"]
    assert doc["status"] == "skipped"
    assert doc["errorCode"] == "WORKSPACE_DISCONNECTED"


async def test_mark_terminal_failed_with_message() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", status="running"))
    await store.mark_terminal_failed(
        "run-1", error_code="MAX_ATTEMPTS_EXHAUSTED", error_message="attempt 5 of 5"
    )
    doc = fs.docs["backgroundRuns/run-1"]
    assert doc["status"] == "terminal_failed"
    assert doc["errorCode"] == "MAX_ATTEMPTS_EXHAUSTED"
    assert doc["errorMessage"] == "attempt 5 of 5"


async def test_mark_retryable_failed() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", status="running"))
    await store.mark_retryable_failed("run-1", error_code="FIRESTORE_UNAVAILABLE")
    assert fs.docs["backgroundRuns/run-1"]["status"] == "retryable_failed"


async def test_mark_noop_when_run_missing() -> None:
    fs = FakeBackgroundFirestore()
    await _store(fs).mark_succeeded("ghost")
    assert "backgroundRuns/ghost" not in fs.docs


async def test_default_now_iso_used_for_finished_at() -> None:
    # No finished_at passed → injected clock default path.
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_run("run-1", status="running"))
    await store.mark_succeeded("run-1")
    assert isinstance(fs.docs["backgroundRuns/run-1"]["finishedAt"], str)
