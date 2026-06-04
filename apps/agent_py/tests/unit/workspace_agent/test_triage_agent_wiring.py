"""Wiring guards for the triage speedup (issue: speed up inbox triage).

Two things must hold:
- triage runs on the cheaper Flash Lite model, while find_workspace keeps
  the stronger model — the switch is scoped, not global.
- the bulk `get_messages` read tool is in the workspace read-tool set so
  triage can fetch every body in one call.
"""

from __future__ import annotations

from lifecoach_agent.workspace_agent.agent import (
    TRIAGE_INBOX_AGENT_MODEL,
    WORKSPACE_AGENT_MODEL,
    _build_read_tools,
)
from lifecoach_agent.workspace_agent.agent_tools.find_workspace import (
    create_find_workspace_tool,
)
from lifecoach_agent.workspace_agent.agent_tools.triage_inbox import (
    create_triage_inbox_tool,
)
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


def _deps() -> WorkspaceToolDeps:
    return WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]


def test_triage_model_is_flash_lite_and_distinct_from_workspace_model() -> None:
    assert TRIAGE_INBOX_AGENT_MODEL == "gemini-flash-lite-latest"
    assert TRIAGE_INBOX_AGENT_MODEL != WORKSPACE_AGENT_MODEL


def test_triage_agent_uses_flash_lite_model() -> None:
    tool = create_triage_inbox_tool(_deps())
    assert tool.agent.model == TRIAGE_INBOX_AGENT_MODEL


def test_find_workspace_agent_keeps_stronger_model() -> None:
    tool = create_find_workspace_tool(_deps())
    assert tool.agent.model == WORKSPACE_AGENT_MODEL


def test_read_tool_set_includes_get_messages() -> None:
    names = {getattr(tool, "name", None) for tool in _build_read_tools(_deps())}
    assert "get_messages" in names
    # The single-message read stays available for targeted refetch.
    assert "get_message" in names
