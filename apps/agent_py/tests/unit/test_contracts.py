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


# --- Workspace triage -----------------------------------------------------


def test_triage_report_requires_context_on_every_bucket() -> None:
    parsed = TriageReport.model_validate(
        {
            "noise": [
                {
                    "id": "m1",
                    "from": "Newsletter <n@example.com>",
                    "subject": "Weekly digest",
                    "context": "received 2h ago; automated digest",
                }
            ],
            "actions": [
                {
                    "id": "m2",
                    "from": "Alex <alex@example.com>",
                    "subject": "Contract renewal",
                    "context": "received today; asks for sign-off by Friday",
                    "task": "Sign the contract by Friday",
                }
            ],
            "events": [
                {
                    "id": "m3",
                    "from": "Sarah <sarah@example.com>",
                    "subject": "Lunch Tuesday 12:30?",
                    "context": "received yesterday; lunch Tue 12:30 at Tortilla",
                    "proposedStart": "2026-05-12T12:30:00+01:00",
                }
            ],
            "info": [
                {
                    "id": "m4",
                    "from": "School <admin@school.example>",
                    "subject": "Photo day",
                    "context": "received yesterday; Year 3 photo day Friday",
                    "note": "Maya needs uniform Friday",
                }
            ],
        }
    )

    assert "received 2h ago" in parsed.noise[0].context
    assert parsed.events[0].from_ == "Sarah <sarah@example.com>"


def test_triage_report_rejects_archive_candidate_without_context() -> None:
    with pytest.raises(ValidationError):
        TriageReport.model_validate(
            {
                "noise": [{"id": "m1", "from": "n@example.com", "subject": "Digest"}],
                "actions": [],
                "events": [],
                "info": [],
            }
        )


# --- Practices ------------------------------------------------------------


def test_practice_metadata_canonical_set() -> None:
    ids = {p.id for p in PRACTICE_METADATA}
    assert ids == {"evening_gratitude", "journaling", "day_planning"}


def test_practice_enabled_path() -> None:
    assert practice_enabled_path("day_planning") == "practices.day_planning.enabled"
    assert practice_enabled_path("evening_gratitude") == "practices.evening_gratitude.enabled"
