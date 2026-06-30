"""Mirrors `packages/shared-types/src/background.test.ts` — same valid /
invalid cases, ported one-for-one. Any drift between the Zod schemas and
the Pydantic models in `lifecoach_agent.contracts.background` trips here."""

from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from lifecoach_agent.contracts import (
    BACKGROUND_RUN_STATUSES,
    BACKGROUND_WORKFLOW_KINDS,
    LOOKBACK_WINDOWS,
    NOTIFICATION_STATUSES,
    PERMITTED_ACTION_MODES,
    PROPOSED_ACTION_STATUSES,
    PROPOSED_ACTION_TYPES,
    SCHEDULE_LAST_STATUSES,
    BackgroundNotification,
    BackgroundProposedAction,
    BackgroundRun,
    BackgroundSchedule,
    sanitize_task_id,
)

VALID_SCHEDULE = {
    "id": "sched_abc123",
    "uid": "uid-1",
    "kind": "email_triage_daily",
    "enabled": True,
    "timezone": "Europe/London",
    "cadence": {"type": "daily", "localTime": "08:00", "weekdays": [1, 2, 3, 4, 5]},
    "lookbackWindow": "1d",
    "consentVersion": "v1",
    "permittedActions": {
        "archiveNoise": "after_confirmation",
        "createTasks": "never",
        "createCalendarEvents": "never",
    },
    "notify": {"inApp": True, "email": False, "chatSummaryOnNextOpen": True},
    "nextRunAt": "2026-05-15T07:00:00.000Z",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "updatedAt": "2026-05-01T00:00:00.000Z",
}

VALID_RUN = {
    "id": "run_20260515_080000Z_3ff1a2",
    "uid": "uid-1",
    "scheduleId": "sched_abc123",
    "kind": "email_triage_daily",
    "status": "queued",
    "idempotencyKey": "sched_abc123:email_triage_daily:2026-05-15T08:00:00Z",
    "scheduledFor": "2026-05-15T08:00:00.000Z",
    "inputWindowStart": "2026-05-14T08:00:00.000Z",
    "inputWindowEnd": "2026-05-15T08:00:00.000Z",
    "attempt": 0,
    "createdAt": "2026-05-15T07:55:00.000Z",
}

VALID_PROPOSED_ACTION = {
    "id": "act_1",
    "uid": "uid-1",
    "runId": "run_20260515_080000Z_3ff1a2",
    "type": "archive_message",
    "status": "proposed",
    "sourceMessageIds": ["m1", "m2"],
    "summary": "Archive 2 newsletters from last week",
    "createdAt": "2026-05-15T08:00:01.000Z",
}

VALID_NOTIFICATION = {
    "id": "note_1",
    "uid": "uid-1",
    "runId": "run_20260515_080000Z_3ff1a2",
    "kind": "email_triage_daily",
    "status": "unread",
    "title": "Morning inbox digest",
    "summary": "2 actions, 1 event, 3 noise",
    "items": [
        {
            "messageId": "m1",
            "threadId": "t1",
            "bucket": "noise",
            "subject": "Digest",
            "snippet": "Top stories",
        },
        {"messageId": "m2", "bucket": "actions", "subject": "Sign-off", "snippet": "Please sign"},
    ],
    "proposedActions": ["act_1"],
    "createdAt": "2026-05-15T08:00:02.000Z",
}


# --- BackgroundSchedule ---------------------------------------------------


def test_schedule_accepts_full() -> None:
    parsed = BackgroundSchedule.model_validate(VALID_SCHEDULE)
    assert parsed.kind == "email_triage_daily"
    assert parsed.cadence.weekdays == [1, 2, 3, 4, 5]


def test_schedule_rejects_unknown_kind() -> None:
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate({**VALID_SCHEDULE, "kind": "send_email"})


def test_schedule_rejects_bad_local_time() -> None:
    bad = {**VALID_SCHEDULE, "cadence": {"type": "daily", "localTime": "8am"}}
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate(bad)


def test_schedule_rejects_out_of_range_weekday() -> None:
    bad = {**VALID_SCHEDULE, "cadence": {"type": "daily", "localTime": "08:00", "weekdays": [7]}}
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate(bad)


def test_schedule_rejects_non_iso_next_run_at() -> None:
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate({**VALID_SCHEDULE, "nextRunAt": "soon"})


def test_schedule_rejects_extra_keys() -> None:
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate({**VALID_SCHEDULE, "extra": 1})


def test_schedule_rejects_date_only_timestamp() -> None:
    # Parses via fromisoformat but has no time component → rejected, matching
    # Zod's z.string().datetime() which requires a full datetime.
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate({**VALID_SCHEDULE, "nextRunAt": "2026-05-15"})


def test_schedule_accepts_omitted_weekdays_and_last_run() -> None:
    every_day = {
        **VALID_SCHEDULE,
        # weekdays OMITTED (not null) → every day
        "cadence": {"type": "daily", "localTime": "08:00"},
        "lastRunAt": "2026-05-14T08:00:00.000Z",
        "lastStatus": "ok",
    }
    parsed = BackgroundSchedule.model_validate(every_day)
    assert parsed.cadence.weekdays is None
    assert parsed.lastRunAt == "2026-05-14T08:00:00.000Z"


def test_schedule_rejects_null_weekdays() -> None:
    # TS uses .optional() (omit ok, explicit null rejected) — mirror it.
    bad = {**VALID_SCHEDULE, "cadence": {"type": "daily", "localTime": "08:00", "weekdays": None}}
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate(bad)


def test_schedule_rejects_non_list_weekdays() -> None:
    bad = {**VALID_SCHEDULE, "cadence": {"type": "daily", "localTime": "08:00", "weekdays": "mon"}}
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate(bad)


def test_schedule_rejects_empty_weekdays() -> None:
    # [] means "no days" → the schedule would never legitimately fire; reject it
    # (mirrors the TS .min(1)). Otherwise next_run_at would degrade to weekly.
    bad = {**VALID_SCHEDULE, "cadence": {"type": "daily", "localTime": "08:00", "weekdays": []}}
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate(bad)


def test_schedule_rejects_offset_timestamp() -> None:
    # z.string().datetime() default rejects numeric offsets; require '…Z'.
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate(
            {**VALID_SCHEDULE, "nextRunAt": "2026-05-15T08:00:00+00:00"}
        )


def test_schedule_rejects_unknown_timezone() -> None:
    # 'not-a-zone' is rejected by both zoneinfo and Intl. (Note: legacy
    # abbreviations like 'PST' diverge — Node's Intl accepts them, zoneinfo
    # doesn't — so the parity test sticks to an unambiguously-invalid value.)
    with pytest.raises(ValidationError):
        BackgroundSchedule.model_validate({**VALID_SCHEDULE, "timezone": "not-a-zone"})


# --- BackgroundRun --------------------------------------------------------


def test_run_accepts_queued() -> None:
    assert BackgroundRun.model_validate(VALID_RUN).status == "queued"


def test_run_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        BackgroundRun.model_validate({**VALID_RUN, "status": "pending"})


def test_run_rejects_negative_attempt() -> None:
    with pytest.raises(ValidationError):
        BackgroundRun.model_validate({**VALID_RUN, "attempt": -1})


def test_run_rejects_string_attempt() -> None:
    # strict int — "0" is not silently coerced (matches z.number().int()).
    with pytest.raises(ValidationError):
        BackgroundRun.model_validate({**VALID_RUN, "attempt": "0"})


def test_run_rejects_negative_cost() -> None:
    with pytest.raises(ValidationError):
        BackgroundRun.model_validate({**VALID_RUN, "tokenCostEstimate": -0.1})


def test_run_accepts_optional_lifecycle_timestamps() -> None:
    full = {
        **VALID_RUN,
        "status": "succeeded",
        "startedAt": "2026-05-15T08:00:01.000Z",
        "finishedAt": "2026-05-15T08:00:05.000Z",
        "leaseExpiresAt": "2026-05-15T08:01:00.000Z",
        "outputRef": "note_1",
        "model": "gemini-flash-lite-latest",
        "tokenCostEstimate": 0.0012,
    }
    parsed = BackgroundRun.model_validate(full)
    assert parsed.finishedAt == "2026-05-15T08:00:05.000Z"


def test_run_rejects_bad_optional_timestamp() -> None:
    with pytest.raises(ValidationError):
        BackgroundRun.model_validate({**VALID_RUN, "startedAt": "nope"})


# --- BackgroundProposedAction ---------------------------------------------


def test_proposed_action_accepts() -> None:
    assert BackgroundProposedAction.model_validate(VALID_PROPOSED_ACTION).type == "archive_message"


def test_proposed_action_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError):
        BackgroundProposedAction.model_validate({**VALID_PROPOSED_ACTION, "type": "send_email"})


def test_proposed_action_rejects_empty_source_ids() -> None:
    # An auditable action must reference ≥1 concrete source message.
    with pytest.raises(ValidationError):
        BackgroundProposedAction.model_validate({**VALID_PROPOSED_ACTION, "sourceMessageIds": []})


def test_proposed_action_accepts_executed_with_result() -> None:
    acted = {**VALID_PROPOSED_ACTION, "status": "executed", "result": {"ok": True, "ref": "thr-1"}}
    parsed = BackgroundProposedAction.model_validate(acted)
    assert parsed.result is not None and parsed.result.ok is True


# --- BackgroundNotification -----------------------------------------------


def test_notification_accepts() -> None:
    parsed = BackgroundNotification.model_validate(VALID_NOTIFICATION)
    assert len(parsed.items) == 2


def test_notification_rejects_unknown_bucket() -> None:
    bad = copy.deepcopy(VALID_NOTIFICATION)
    bad["items"][0]["bucket"] = "urgent"
    with pytest.raises(ValidationError):
        BackgroundNotification.model_validate(bad)


def test_notification_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        BackgroundNotification.model_validate({**VALID_NOTIFICATION, "status": "archived"})


def test_notification_accepts_expires_at_and_rejects_bad_one() -> None:
    ok = {**VALID_NOTIFICATION, "expiresAt": "2026-05-22T08:00:00.000Z"}
    assert BackgroundNotification.model_validate(ok).expiresAt == "2026-05-22T08:00:00.000Z"
    with pytest.raises(ValidationError):
        BackgroundNotification.model_validate({**VALID_NOTIFICATION, "expiresAt": "never"})


def test_notification_rejects_blank_proposed_action_id() -> None:
    with pytest.raises(ValidationError):
        BackgroundNotification.model_validate({**VALID_NOTIFICATION, "proposedActions": [""]})


def test_proposed_action_rejects_blank_source_id() -> None:
    with pytest.raises(ValidationError):
        BackgroundProposedAction.model_validate({**VALID_PROPOSED_ACTION, "sourceMessageIds": [""]})


# --- sanitize_task_id -----------------------------------------------------


def test_sanitize_replaces_colons() -> None:
    assert sanitize_task_id("2026-05-15T08:00:00Z") == "2026-05-15T08_00_00Z"


def test_sanitize_leaves_valid_id_untouched() -> None:
    valid = "background-email_triage_daily-a1b2c3d4-20260515T080000Z-7f9e2a"
    assert sanitize_task_id(valid) == valid


def test_sanitize_replaces_dots_slashes_at() -> None:
    assert sanitize_task_id("a.b/c@d") == "a_b_c_d"


def test_sanitize_keeps_allowed_chars() -> None:
    assert sanitize_task_id("A-z_0-9") == "A-z_0-9"


# --- canonical constant parity --------------------------------------------


def test_canonical_constants_match_ts() -> None:
    assert BACKGROUND_WORKFLOW_KINDS == ("email_triage_daily", "email_urgent_scan")
    assert PERMITTED_ACTION_MODES == ("never", "after_confirmation", "auto_if_rule_matches")
    assert LOOKBACK_WINDOWS == ("12h", "1d", "3d")
    assert SCHEDULE_LAST_STATUSES == ("ok", "skipped", "failed")
    assert BACKGROUND_RUN_STATUSES == (
        "queued",
        "running",
        "succeeded",
        "retryable_failed",
        "terminal_failed",
        "skipped",
        "cancelled",
        "superseded",
    )
    assert PROPOSED_ACTION_TYPES == (
        "archive_message",
        "create_task",
        "create_calendar_event",
    )
    assert PROPOSED_ACTION_STATUSES == (
        "proposed",
        "approved",
        "rejected",
        "executed",
        "failed",
    )
    assert NOTIFICATION_STATUSES == ("unread", "read", "dismissed", "acted_on")
