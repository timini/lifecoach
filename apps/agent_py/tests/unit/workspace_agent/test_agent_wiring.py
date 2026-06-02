"""Tests for Workspace sub-agent wiring."""

from __future__ import annotations

from typing import Any, cast

from lifecoach_agent.workspace_agent.agent import TRIAGE_INBOX_AGENT_MODEL
from lifecoach_agent.workspace_agent.agent_tools.triage_inbox import (
    TRIAGE_INBOX_INSTRUCTION,
    create_triage_inbox_tool,
)
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


class _FakeStore:
    pass


def test_triage_inbox_uses_flash_lite_model() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]

    tool = create_triage_inbox_tool(deps)

    agent = cast(Any, tool.agent)

    assert agent.model == TRIAGE_INBOX_AGENT_MODEL
    assert TRIAGE_INBOX_AGENT_MODEL == "gemini-flash-lite-latest"


def test_triage_instruction_prefers_bulk_fetch_email() -> None:
    assert "bulk_fetch_email once" in TRIAGE_INBOX_INSTRUCTION
    assert "Use get_message only" in TRIAGE_INBOX_INSTRUCTION
