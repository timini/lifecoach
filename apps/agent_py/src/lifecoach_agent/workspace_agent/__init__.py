"""Workspace module entry point. The main agent imports this exactly
once and gates it on `userState === 'workspace_connected'`. The returned
list is everything the main agent needs to talk to Google Workspace —
the generic `call_workspace` dispatcher is gone.

Returned tools, in order:
  1. triage_inbox()           — AgentTool wrapping the triage sub-agent
  2. find_workspace(query)    — AgentTool wrapping the search sub-agent
  3. archive_messages(ids)    — FunctionTool — direct, no LLM hop
  4. add_calendar_event(...)  — FunctionTool — direct, no LLM hop
  5. add_task(...)            — FunctionTool — direct, no LLM hop
  6. complete_task(id)        — FunctionTool — direct, no LLM hop
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from typing import Any

from lifecoach_agent.storage.workspace_tokens import WorkspaceTokensStore
from lifecoach_agent.workspace_agent.agent import (
    WORKSPACE_AGENT_INSTRUCTION,
    WORKSPACE_AGENT_MODEL,
    WORKSPACE_AGENT_NAME,
    create_workspace_agent,
)
from lifecoach_agent.workspace_agent.agent_tools import (
    FIND_WORKSPACE_TOOL_NAME,
    TRIAGE_INBOX_TOOL_NAME,
    create_find_workspace_tool,
    create_triage_inbox_tool,
    parse_triage_report,
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
from lifecoach_agent.workspace_agent.run_gws import (
    LogEmitter,
    RunGwsErr,
    RunGwsLogEvent,
    RunGwsOk,
    RunGwsResult,
    run_gws,
)
from lifecoach_agent.workspace_agent.tools import (
    ADD_CALENDAR_EVENT_TOOL_NAME,
    ADD_TASK_TOOL_NAME,
    ARCHIVE_MESSAGES_TOOL_NAME,
    COMPLETE_TASK_TOOL_NAME,
    create_add_calendar_event_tool,
    create_add_task_tool,
    create_archive_messages_tool,
    create_complete_task_tool,
)
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


@dataclass(frozen=True)
class WorkspaceModuleDeps:
    """Inputs to `create_workspace_tools`. `sub_agent_log` is kept
    distinct from `log` so Cloud Logging filters can split main-agent
    workspace calls from sub-agent internal calls.

    `event_queue` is the per-request SSE queue threaded by
    `server.py`. When set, `BridgedAgentTool` will mirror inner
    workspace sub-agent tool calls to it so the live UI shows nested
    badges under `triage_inbox` / `find_workspace`.
    """

    store: WorkspaceTokensStore
    uid: str
    build_client: Any | None = None
    log: LogEmitter | None = None
    sub_agent_log: LogEmitter | None = None
    event_queue: asyncio.Queue[bytes | None] | None = None


def create_workspace_tools(deps: WorkspaceModuleDeps) -> list[Any]:
    """Build the 6 workspace-facing tools (2 AgentTools + 4 narrow writes)
    for the main agent. Closes over `deps.uid` + `deps.store` so the LLM
    never sees auth values."""
    main_tool_deps = WorkspaceToolDeps(
        store=deps.store, uid=deps.uid, build_client=deps.build_client, log=deps.log
    )
    sub_agent_deps = replace(main_tool_deps, log=deps.sub_agent_log)
    return [
        create_triage_inbox_tool(sub_agent_deps, event_queue=deps.event_queue),
        create_find_workspace_tool(sub_agent_deps, event_queue=deps.event_queue),
        create_archive_messages_tool(main_tool_deps),
        create_add_calendar_event_tool(main_tool_deps),
        create_add_task_tool(main_tool_deps),
        create_complete_task_tool(main_tool_deps),
    ]


# Names of the 6 tools the factory returns, in order. Importable for the
# state policy + tests.
WORKSPACE_TOOL_NAMES: tuple[str, ...] = (
    TRIAGE_INBOX_TOOL_NAME,
    FIND_WORKSPACE_TOOL_NAME,
    ARCHIVE_MESSAGES_TOOL_NAME,
    ADD_CALENDAR_EVENT_TOOL_NAME,
    ADD_TASK_TOOL_NAME,
    COMPLETE_TASK_TOOL_NAME,
)


__all__ = [
    "ADD_CALENDAR_EVENT_TOOL_NAME",
    "ADD_TASK_TOOL_NAME",
    "ARCHIVE_MESSAGES_TOOL_NAME",
    "COMPLETE_TASK_TOOL_NAME",
    "FIND_WORKSPACE_TOOL_NAME",
    "MAX_RESPONSE_BYTES",
    "TRIAGE_INBOX_TOOL_NAME",
    "WORKSPACE_AGENT_INSTRUCTION",
    "WORKSPACE_AGENT_MODEL",
    "WORKSPACE_AGENT_NAME",
    "WORKSPACE_SERVICES",
    "WORKSPACE_TOOL_NAMES",
    "CallWorkspaceErr",
    "CallWorkspaceErrorCode",
    "CallWorkspaceOk",
    "CallWorkspaceResult",
    "LogEmitter",
    "RunGwsErr",
    "RunGwsLogEvent",
    "RunGwsOk",
    "RunGwsResult",
    "WorkspaceModuleDeps",
    "WorkspaceService",
    "WorkspaceToolDeps",
    "call_workspace",
    "create_add_calendar_event_tool",
    "create_add_task_tool",
    "create_archive_messages_tool",
    "create_complete_task_tool",
    "create_find_workspace_tool",
    "create_triage_inbox_tool",
    "create_workspace_agent",
    "create_workspace_tools",
    "parse_triage_report",
    "run_gws",
]
