"""Unit tests for deterministic background ids (ADR 0001 §4)."""

from __future__ import annotations

import re

from lifecoach_agent.background import ids

_VALID_TASK_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def test_uid_hash_is_stable_and_not_the_raw_uid() -> None:
    h = ids.uid_hash("firebase-uid-123")
    assert h == ids.uid_hash("firebase-uid-123")
    assert "firebase-uid-123" not in h
    assert len(h) == 8


def test_idempotency_key_shape() -> None:
    key = ids.idempotency_key("s1", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    assert key == "s1:email_triage_daily:2026-05-15T08:00:00.000Z"


def test_run_id_deterministic_per_occurrence() -> None:
    a = ids.run_id("s1", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    b = ids.run_id("s1", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    assert a == b
    assert a.startswith("run_20260515T080000Z_")


def test_run_id_differs_by_occurrence_and_schedule() -> None:
    base = ids.run_id("s1", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    assert base != ids.run_id("s2", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    assert base != ids.run_id("s1", "email_triage_daily", "2026-05-16T08:00:00.000Z")


def test_task_id_is_sanitized_and_deterministic() -> None:
    t = ids.task_id("s1", "email_triage_daily", "uid-123", "2026-05-15T08:00:00.000Z")
    assert _VALID_TASK_ID.match(t)
    assert t == ids.task_id("s1", "email_triage_daily", "uid-123", "2026-05-15T08:00:00.000Z")
    # No raw colon from the timestamp survives.
    assert ":" not in t
    assert "20260515T080000Z" in t


def test_task_id_shares_short_hash_with_run_id() -> None:
    rid = ids.run_id("s1", "email_triage_daily", "2026-05-15T08:00:00.000Z")
    # run_id ignores uid; task_id includes it. They share the (schedule,kind,
    # scheduledFor) short hash suffix.
    short = rid.rsplit("_", 1)[-1]
    tid = ids.task_id("s1", "email_triage_daily", "uid-123", "2026-05-15T08:00:00.000Z")
    assert tid.endswith(short)
