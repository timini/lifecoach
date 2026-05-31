"""Prompt guardrails for the `find_workspace` sub-agent."""

from __future__ import annotations

from lifecoach_agent.workspace_agent.agent_tools.find_workspace import _FIND_INSTRUCTION


def test_find_workspace_prefers_list_calendars_for_calendar_id_requests() -> None:
    assert "list_calendars" in _FIND_INSTRUCTION
    assert "Calendar list / IDs" in _FIND_INSTRUCTION
    assert "Do not search Gmail" in _FIND_INSTRUCTION
    assert "list my Google calendars and find the family calendar ID" in _FIND_INSTRUCTION
