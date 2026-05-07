"""Workspace tooling.

This module currently exposes a single dispatch tool, `call_workspace`,
matching the existing TS surface. Phase 7's planned full sub-agent
redesign (separate ADK Agent with 9 narrow internal tools and 2
AgentTool wrappers — `triage_inbox`, `find_workspace`) lands as a
follow-up; the placeholder design lives in the migration plan.
"""

from lifecoach_agent.workspace_agent.call_workspace import (
    CALL_WORKSPACE_TOOL_NAME,
    create_call_workspace_tool,
)
from lifecoach_agent.workspace_agent.gws_client import (
    MAX_RESPONSE_BYTES,
    WORKSPACE_SERVICES,
    CallWorkspaceErr,
    CallWorkspaceErrorCode,
    CallWorkspaceOk,
    CallWorkspaceResult,
    WorkspaceService,
    call_workspace,
)

__all__ = [
    "CALL_WORKSPACE_TOOL_NAME",
    "MAX_RESPONSE_BYTES",
    "WORKSPACE_SERVICES",
    "CallWorkspaceErr",
    "CallWorkspaceErrorCode",
    "CallWorkspaceOk",
    "CallWorkspaceResult",
    "WorkspaceService",
    "call_workspace",
    "create_call_workspace_tool",
]
