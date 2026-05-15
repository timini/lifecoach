"""Prompt/tool wiring guardrails for calendar-list requests."""

from __future__ import annotations

from lifecoach_agent.prompt.build_instruction import WORKSPACE_CHEATSHEET
from lifecoach_agent.workspace_agent.agent import WORKSPACE_AGENT_INSTRUCTION, _build_read_tools
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


def _tool_name(tool: object) -> str:
    return str(getattr(tool, "name", None) or getattr(tool, "_name", None))


def test_workspace_read_tools_include_list_calendars_before_event_listing() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    names = [_tool_name(tool) for tool in _build_read_tools(deps)]

    assert "list_calendars" in names
    assert names.index("list_calendars") < names.index("list_events")


def test_calendar_id_prompts_prefer_list_calendars_over_message_search() -> None:
    assert "call list_calendars first" in WORKSPACE_AGENT_INSTRUCTION
    assert "Do not call search_messages" in WORKSPACE_AGENT_INSTRUCTION
    assert "find my Family calendar ID" in WORKSPACE_CHEATSHEET
    assert "workspace.default_family_calendar_id" in WORKSPACE_CHEATSHEET
