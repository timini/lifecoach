"""Stub agent module for the **find_workspace** sub-agent (Tier-1 evals).

The issue #130 fixture targets this module directly so the evaluator can
assert the inner workspace-search agent calls ``list_calendars`` for a
calendar-ID request, rather than falling back to Gmail ``search_messages``.
"""

from __future__ import annotations

from typing import Any

from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

from lifecoach_agent.workspace_agent.agent import create_workspace_agent
from lifecoach_agent.workspace_agent.agent_tools.find_workspace import (
    _FIND_INSTRUCTION,
    FIND_WORKSPACE_TOOL_NAME,
    FindWorkspaceInput,
)
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


def _stub_before_tool(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
) -> Any | None:
    name = getattr(tool, "name", None) or tool.__class__.__name__
    if name == "list_calendars":
        return {
            "status": "ok",
            "calendars": [
                {
                    "id": "primary@example.com",
                    "summary": "Tim",
                    "primary": True,
                    "accessRole": "owner",
                    "timeZone": "America/New_York",
                },
                {
                    "id": "family-123@group.calendar.google.com",
                    "summary": "Family",
                    "primary": False,
                    "accessRole": "writer",
                    "timeZone": "America/New_York",
                    "description": "Shared family calendar",
                },
            ],
        }
    if name in {"search_messages", "get_message", "list_events", "list_tasks", "list_inbox"}:
        return {
            "status": "ok",
            "messages": [],
            "events": [],
            "tasks": [],
        }
    return None


class _FakeTokensStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


def _build_eval_root_agent() -> Any:
    deps = WorkspaceToolDeps(store=_FakeTokensStore(), uid="eval-find-uid")  # type: ignore[arg-type]
    agent = create_workspace_agent(
        deps=deps,
        name=FIND_WORKSPACE_TOOL_NAME,
        description="Workspace search sub-agent (eval).",
        instruction=_FIND_INSTRUCTION,
        input_schema=FindWorkspaceInput,
    )
    agent.before_tool_callback = _stub_before_tool
    return agent


root_agent = _build_eval_root_agent()
