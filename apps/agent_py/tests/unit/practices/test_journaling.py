"""Directive-half mirror of
`apps/agent/src/practices/journaling.test.ts`. Tool-factory tests for
`journal_entry` land in Phase 6 with the ProfileStore."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from lifecoach_agent.practices import journaling
from lifecoach_agent.practices.types import PracticeCtx
from lifecoach_agent.prompt.build_instruction import InstructionContext


def _ctx() -> PracticeCtx:
    base = InstructionContext(
        now=datetime(2026, 4, 28, 11, 0, tzinfo=ZoneInfo("UTC")),
        timezone="Europe/London",
        user_state="workspace_connected",
    )
    return PracticeCtx(base=base, practice_state={})


def test_directive_always_emits_when_on() -> None:
    out = journaling.directive(_ctx())  # type: ignore[misc]
    assert out is not None
    assert "JOURNALING" in out
    assert "journal_entry" in out


def test_metadata() -> None:
    assert journaling.id == "journaling"
    assert journaling.label == "Journaling"
