from __future__ import annotations

from lifecoach_agent.workspace_agent.agent_tools import (
    create_find_workspace_tool,
    create_triage_inbox_tool,
)
from lifecoach_agent.workspace_agent.bridged_agent_tool import BridgedAgentTool
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


class _FakeStore:
    pass


def test_workspace_agent_tools_use_bridged_agent_tool() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]

    assert isinstance(create_triage_inbox_tool(deps), BridgedAgentTool)
    assert isinstance(create_find_workspace_tool(deps), BridgedAgentTool)
