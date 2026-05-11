"""Mirrors the directive half of
`apps/agent/src/practices/eveningGratitude.test.ts`. The tool factory
tests live in `tests/unit/tools/` once Phase 6 wires the
ProfileStore."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from lifecoach_agent.practices import evening_gratitude
from lifecoach_agent.practices.types import PracticeCtx
from lifecoach_agent.prompt.build_instruction import InstructionContext

BASE_NOW = datetime(2026, 4, 28, 19, 0, tzinfo=ZoneInfo("UTC"))  # 8pm London (BST)


def _ctx(
    *,
    now: datetime = BASE_NOW,
    practice_state: dict[str, Any] | None = None,
) -> PracticeCtx:
    base = InstructionContext(now=now, timezone="Europe/London", user_state="workspace_connected")
    return PracticeCtx(base=base, practice_state=practice_state or {})


def test_emits_in_evening_window_when_not_logged() -> None:
    out = evening_gratitude.directive(_ctx())  # type: ignore[misc]
    assert out is not None
    assert "EVENING_GRATITUDE" in out
    assert "log_gratitude" in out


def test_skips_before_18_local() -> None:
    # 09:00 London = 08:00 UTC summer time (BST)
    out = evening_gratitude.directive(  # type: ignore[misc]
        _ctx(now=datetime(2026, 4, 28, 8, 0, tzinfo=ZoneInfo("UTC")))
    )
    assert out is None


def test_skips_after_2300_local() -> None:
    # 02:00 London (next day) = 01:00 UTC
    out = evening_gratitude.directive(  # type: ignore[misc]
        _ctx(now=datetime(2026, 4, 29, 1, 0, tzinfo=ZoneInfo("UTC")))
    )
    assert out is None


def test_skips_when_logged_today() -> None:
    out = evening_gratitude.directive(  # type: ignore[misc]
        _ctx(practice_state={"last_logged": "2026-04-28"})
    )
    assert out is None


def test_emits_when_logged_yesterday() -> None:
    out = evening_gratitude.directive(  # type: ignore[misc]
        _ctx(practice_state={"last_logged": "2026-04-27"})
    )
    assert out is not None
