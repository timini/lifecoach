"""Mirrors `apps/agent/src/practices/dayPlanning.test.ts`."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from lifecoach_agent.practices import day_planning
from lifecoach_agent.practices.types import PracticeCtx
from lifecoach_agent.prompt.build_instruction import InstructionContext

# 08:00 London (BST = UTC+1) on 2026-05-06 → in the morning window
BASE_NOW = datetime(2026, 5, 6, 7, 0, tzinfo=ZoneInfo("UTC"))


def _ctx(
    *,
    now: datetime = BASE_NOW,
    user_state: str = "google_linked",
    practice_state: dict[str, Any] | None = None,
) -> PracticeCtx:
    base = InstructionContext(
        now=now,
        timezone="Europe/London",
        user_state=user_state,  # type: ignore[arg-type]
    )
    return PracticeCtx(base=base, practice_state=practice_state or {})


# --- time gate -----------------------------------------------------------


def test_emits_in_morning_window_when_not_planned() -> None:
    out = day_planning.directive(_ctx())  # type: ignore[misc]
    assert out is not None
    assert "DAY_PLANNING" in out


def test_skips_before_5_local() -> None:
    # 03:00 London = 02:00 UTC summer (BST)
    out = day_planning.directive(_ctx(now=datetime(2026, 5, 6, 2, 0, tzinfo=ZoneInfo("UTC"))))  # type: ignore[misc]
    assert out is None


def test_skips_at_11_local() -> None:
    # 11:00 London = 10:00 UTC summer (BST)
    out = day_planning.directive(_ctx(now=datetime(2026, 5, 6, 10, 0, tzinfo=ZoneInfo("UTC"))))  # type: ignore[misc]
    assert out is None


def test_emits_at_exactly_10_local() -> None:
    out = day_planning.directive(_ctx(now=datetime(2026, 5, 6, 9, 0, tzinfo=ZoneInfo("UTC"))))  # type: ignore[misc]
    assert out is not None


# --- idempotency ---------------------------------------------------------


def test_skips_when_planned_today() -> None:
    out = day_planning.directive(  # type: ignore[misc]
        _ctx(practice_state={"last_planned_date": "2026-05-06"})
    )
    assert out is None


def test_emits_when_planned_yesterday() -> None:
    out = day_planning.directive(  # type: ignore[misc]
        _ctx(practice_state={"last_planned_date": "2026-05-05"})
    )
    assert out is not None


# --- workspace arm vs light arm ------------------------------------------


def test_workspace_arm_when_workspace_connected() -> None:
    out = day_planning.directive(_ctx(user_state="workspace_connected"))  # type: ignore[misc]
    assert out is not None
    assert "Archive N messages?" in out
    assert "from`, `subject`, and `context`" in out
    assert "without opening" in out
    assert "triage_inbox" in out
    assert "archive_messages" in out
    assert "add_calendar_event" in out


def test_light_arm_when_google_linked() -> None:
    out = day_planning.directive(_ctx(user_state="google_linked"))  # type: ignore[misc]
    assert out is not None
    assert "most important thing" in out
    assert "triage_inbox" not in out
    assert "Archive N messages" not in out


def test_light_arm_when_anonymous() -> None:
    out = day_planning.directive(_ctx(user_state="anonymous"))  # type: ignore[misc]
    assert out is not None
    assert "triage_inbox" not in out


def test_directive_stamps_idempotency_key() -> None:
    out = day_planning.directive(_ctx())  # type: ignore[misc]
    assert out is not None
    assert "practices.day_planning.last_planned_date" in out
    assert "2026-05-06" in out


# --- metadata ------------------------------------------------------------


def test_metadata_id_is_stable() -> None:
    assert day_planning.id == "day_planning"


def test_metadata_label_and_description() -> None:
    assert day_planning.label == "Plan the day"
    assert "priorities" in day_planning.description.lower()


def test_metadata_offer_hint_present() -> None:
    assert day_planning.offer_hint is not None
    text = day_planning.offer_hint.lower()
    assert any(w in text for w in ("inbox", "focus", "day"))


# --- examples ------------------------------------------------------------


def test_examples_workspace_arm() -> None:
    out = day_planning.examples(_ctx(user_state="workspace_connected"))  # type: ignore[misc]
    assert out is not None
    assert "triage_inbox" in out
    assert "archive_messages" in out
    assert "• Substack Weekly" in out
    assert "received 2h ago" in out


def test_examples_light_arm() -> None:
    out = day_planning.examples(_ctx(user_state="anonymous"))  # type: ignore[misc]
    assert out is not None
    # Light example doesn't reference workspace tools.
    assert "triage_inbox" not in out
    assert "archive_messages" not in out


# --- replace() smoke (dataclass invariants) ------------------------------


def test_practice_dataclass_is_frozen() -> None:
    # replace() should work but mutations on the original should not.
    new = replace(day_planning, label="Other")
    assert new.label == "Other"
    assert day_planning.label == "Plan the day"
