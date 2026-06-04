"""Mirrors `packages/shared-types/src/*.test.ts` — same valid/invalid
cases, ported one-for-one. Any drift between the Zod schemas and these
Pydantic models trips here."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from lifecoach_agent.contracts import (
    AUTH_MODES,
    AUTH_USER_TOOL_NAME,
    CHOICE_TOOL_NAMES,
    GOAL_STATUSES,
    PRACTICE_METADATA,
    WORKSPACE_SCOPES,
    AuthUserArgs,
    ChoiceQuestion,
    GoalUpdate,
    TriageReport,
    UserProfile,  # noqa: F401 — type alias, imported for parity with TS index
    WorkspaceStatus,
    empty_user_profile,
    practice_enabled_path,
)

# --- AuthUserArgs ---------------------------------------------------------


def test_auth_args_google_no_email() -> None:
    parsed = AuthUserArgs.model_validate({"mode": "google"})
    assert parsed.mode == "google"
    assert parsed.email is None


def test_auth_args_email_with_valid_address() -> None:
    parsed = AuthUserArgs.model_validate({"mode": "email", "email": "tim@example.com"})
    assert parsed.email == "tim@example.com"


def test_auth_args_rejects_invalid_email() -> None:
    with pytest.raises(ValidationError):
        AuthUserArgs.model_validate({"mode": "email", "email": "not-an-email"})


def test_auth_args_rejects_unknown_mode() -> None:
    with pytest.raises(ValidationError):
        AuthUserArgs.model_validate({"mode": "sms"})


def test_auth_args_rejects_extra_keys() -> None:
    with pytest.raises(ValidationError):
        AuthUserArgs.model_validate({"mode": "google", "extra": "nope"})


def test_auth_canonical_constants() -> None:
    assert AUTH_MODES == ("google", "email")
    assert AUTH_USER_TOOL_NAME == "auth_user"


# --- ChoiceQuestion -------------------------------------------------------


def test_choice_two_to_eight_options() -> None:
    parsed = ChoiceQuestion.model_validate({"question": "How are you?", "options": ["good", "meh"]})
    assert len(parsed.options) == 2


def test_choice_rejects_one_option() -> None:
    with pytest.raises(ValidationError):
        ChoiceQuestion.model_validate({"question": "q", "options": ["only one"]})


def test_choice_rejects_nine_options() -> None:
    with pytest.raises(ValidationError):
        ChoiceQuestion.model_validate({"question": "q", "options": [f"o{i}" for i in range(9)]})


def test_choice_rejects_empty_option_string() -> None:
    with pytest.raises(ValidationError):
        ChoiceQuestion.model_validate({"question": "q", "options": ["ok", ""]})


def test_choice_rejects_extra_keys() -> None:
    with pytest.raises(ValidationError):
        ChoiceQuestion.model_validate({"question": "q", "options": ["a", "b"], "extra": True})


def test_choice_tool_names() -> None:
    assert CHOICE_TOOL_NAMES["single"] == "ask_single_choice_question"
    assert CHOICE_TOOL_NAMES["multiple"] == "ask_multiple_choice_question"


# --- GoalUpdate -----------------------------------------------------------


def test_goal_update_minimal() -> None:
    parsed = GoalUpdate.model_validate(
        {"timestamp": "2026-04-21T09:00:00.000Z", "goal": "Running", "status": "progress"}
    )
    assert parsed.note is None
    assert parsed.goal == "Running"


def test_goal_update_with_note() -> None:
    parsed = GoalUpdate.model_validate(
        {
            "timestamp": "2026-04-21T09:00:00.000Z",
            "goal": "Running",
            "status": "completed",
            "note": "First 10k!",
        }
    )
    assert parsed.note == "First 10k!"


def test_goal_update_rejects_non_iso_timestamp() -> None:
    with pytest.raises(ValidationError):
        GoalUpdate.model_validate({"timestamp": "yesterday", "goal": "x", "status": "started"})


def test_goal_update_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        GoalUpdate.model_validate(
            {"timestamp": "2026-04-21T09:00:00.000Z", "goal": "x", "status": "frozen"}
        )


def test_goal_update_rejects_extra_keys() -> None:
    with pytest.raises(ValidationError):
        GoalUpdate.model_validate(
            {
                "timestamp": "2026-04-21T09:00:00.000Z",
                "goal": "x",
                "status": "started",
                "extra": 1,
            }
        )


def test_goal_canonical_statuses() -> None:
    assert GOAL_STATUSES == ("started", "progress", "completed", "paused", "abandoned")


# --- UserProfile ----------------------------------------------------------


def test_empty_user_profile_starter_template() -> None:
    p = empty_user_profile()
    assert p["name"] is None
    assert p["location"] == {"address": None}
    assert p["goals"] == {
        "short_term": [],
        "medium_term": [],
        "long_term": [],
        "currently_working_on": None,
    }


def test_profile_accepts_arbitrary_keys() -> None:
    """Schema-free by design — no validation needed for arbitrary keys."""
    profile = {
        "name": "Alex",
        "pets": {"name": "Cosmo", "species": "dog"},
        "morning_routine": ["stretch", "shower", "breakfast"],
        "volunteering": "community garden weekends",
    }
    # UserProfile is a type alias for dict[str, Any] — no runtime check
    # imposed here, matching the Zod `record(string, unknown)` behaviour.
    assert profile["pets"] == {"name": "Cosmo", "species": "dog"}


# --- WorkspaceStatus ------------------------------------------------------


def test_workspace_scopes_full_set() -> None:
    assert "https://mail.google.com/" in WORKSPACE_SCOPES
    assert "https://www.googleapis.com/auth/calendar" in WORKSPACE_SCOPES
    assert "https://www.googleapis.com/auth/tasks" in WORKSPACE_SCOPES


def test_workspace_scopes_excludes_drive_and_sheets() -> None:
    for scope in WORKSPACE_SCOPES:
        assert "drive" not in scope
        assert "spreadsheets" not in scope


def test_workspace_status_connected() -> None:
    parsed = WorkspaceStatus.model_validate(
        {
            "connected": True,
            "scopes": list(WORKSPACE_SCOPES),
            "grantedAt": "2026-04-21T09:00:00.000Z",
        }
    )
    assert parsed.connected is True
    assert parsed.grantedAt == "2026-04-21T09:00:00.000Z"


def test_workspace_status_null_grantedAt() -> None:
    parsed = WorkspaceStatus.model_validate({"connected": False, "scopes": [], "grantedAt": None})
    assert parsed.grantedAt is None


def test_workspace_status_rejects_extra_keys() -> None:
    with pytest.raises(ValidationError):
        WorkspaceStatus.model_validate(
            {"connected": True, "scopes": [], "grantedAt": None, "extra": 1}
        )


# --- Practices ------------------------------------------------------------


def test_practice_metadata_canonical_set() -> None:
    ids = {p.id for p in PRACTICE_METADATA}
    assert ids == {"evening_gratitude", "journaling", "day_planning"}


def test_practice_enabled_path() -> None:
    assert practice_enabled_path("day_planning") == "practices.day_planning.enabled"
    assert practice_enabled_path("evening_gratitude") == "practices.evening_gratitude.enabled"


# --- TriageReport (mirror of triageReport.test.ts) ------------------------


def test_triage_report_requires_per_message_context() -> None:
    parsed = TriageReport.model_validate(
        {
            "noise": [
                {
                    "id": "m1",
                    "threadId": "t1",
                    "from": "news@example.com",
                    "subject": "Digest",
                    "receivedAt": "Mon, 11 May 2026 09:00:00 +0100",
                    "snippet": "Top stories this week...",
                }
            ],
            "actions": [
                {
                    "id": "m2",
                    "from": "alex@example.com",
                    "subject": "Sign-off",
                    "receivedAt": "Mon, 11 May 2026 09:05:00 +0100",
                    "snippet": "Please sign by Friday...",
                    "task": "sign contract by Friday",
                }
            ],
            "events": [
                {
                    "id": "m3",
                    "from": "sarah@example.com",
                    "subject": "Lunch",
                    "receivedAt": "Mon, 11 May 2026 09:10:00 +0100",
                    "snippet": "Lunch Tuesday 12:30?",
                    "proposedStart": "2026-05-12T12:30:00+01:00",
                }
            ],
            "info": [
                {
                    "id": "m4",
                    "from": "school@example.com",
                    "subject": "Photo day",
                    "receivedAt": "Mon, 11 May 2026 09:15:00 +0100",
                    "snippet": "Photo day Friday...",
                    "note": "Friday, uniform",
                }
            ],
        }
    )
    assert parsed.noise[0].snippet == "Top stories this week..."
    assert parsed.events[0].from_ == "sarah@example.com"


def test_triage_report_rejects_noise_without_snippet() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [
                    {
                        "id": "m1",
                        "from": "news@example.com",
                        "subject": "Digest",
                        "receivedAt": "Mon, 11 May 2026 09:00:00 +0100",
                    }
                ],
                "actions": [],
                "events": [],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_snippet() -> None:
    # Matches the Zod `.min(1)` — a whitespace-free empty context is invalid
    # so the parent never builds a context-free archive prompt.
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [
                    {
                        "id": "m1",
                        "from": "news@example.com",
                        "subject": "Digest",
                        "receivedAt": "Mon, 11 May 2026 09:00:00 +0100",
                        "snippet": "",
                    }
                ],
                "actions": [],
                "events": [],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_id() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [
                    {
                        "id": "",
                        "from": "news@example.com",
                        "subject": "Digest",
                        "receivedAt": "Mon, 11 May 2026 09:00:00 +0100",
                        "snippet": "Top stories",
                    }
                ],
                "actions": [],
                "events": [],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_thread_id() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [
                    {
                        "id": "m1",
                        "threadId": "",
                        "from": "news@example.com",
                        "subject": "Digest",
                        "receivedAt": "Mon, 11 May 2026 09:00:00 +0100",
                        "snippet": "Top stories",
                    }
                ],
                "actions": [],
                "events": [],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_task() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [],
                "actions": [
                    {
                        "id": "m2",
                        "from": "a@x",
                        "subject": "Sign-off",
                        "receivedAt": "Mon, 11 May 2026 09:05:00 +0100",
                        "snippet": "Please sign",
                        "task": "",
                    }
                ],
                "events": [],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_proposed_start() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [],
                "actions": [],
                "events": [
                    {
                        "id": "m3",
                        "from": "sarah@x",
                        "subject": "Lunch",
                        "receivedAt": "Mon, 11 May 2026 09:10:00 +0100",
                        "snippet": "Lunch Tuesday",
                        "proposedStart": "",
                    }
                ],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_proposed_end() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [],
                "actions": [],
                "events": [
                    {
                        "id": "m3",
                        "from": "sarah@x",
                        "subject": "Lunch",
                        "receivedAt": "Mon, 11 May 2026 09:10:00 +0100",
                        "snippet": "Lunch Tuesday",
                        "proposedStart": "2026-05-12T12:30:00+01:00",
                        "proposedEnd": "",
                    }
                ],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_location() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [],
                "actions": [],
                "events": [
                    {
                        "id": "m3",
                        "from": "sarah@x",
                        "subject": "Lunch",
                        "receivedAt": "Mon, 11 May 2026 09:10:00 +0100",
                        "snippet": "Lunch Tuesday",
                        "proposedStart": "2026-05-12T12:30:00+01:00",
                        "location": "",
                    }
                ],
                "info": [],
            }
        )


def test_triage_report_rejects_blank_note() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [],
                "actions": [],
                "events": [],
                "info": [
                    {
                        "id": "m4",
                        "from": "school@x",
                        "subject": "Photo day",
                        "receivedAt": "Mon, 11 May 2026 09:15:00 +0100",
                        "snippet": "Photo day Friday",
                        "note": "",
                    }
                ],
            }
        )
