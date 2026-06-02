"""Google Workspace sub-agent — a Flash-backed LlmAgent with narrow,
read-only internal tools. Wrapped by AgentTool entry points
(triage_inbox, find_workspace) the main coach agent sees.

The write tools (archive_messages, add_calendar_event, add_task,
complete_task, create_draft_email) live in the sub-agent's toolset too,
so a future
"act inline" prompt can run end-to-end inside the sub-agent — but for
now they're exposed on the main agent directly to keep single-step
writes off the sub-agent's LLM hop.
"""

from __future__ import annotations

from typing import Any

from google.adk.agents import LlmAgent
from pydantic import BaseModel

from lifecoach_agent.workspace_agent.tools import (
    create_add_calendar_event_tool,
    create_add_task_tool,
    create_archive_messages_tool,
    create_complete_task_tool,
    create_create_draft_email_tool,
    create_get_message_tool,
    create_list_events_tool,
    create_list_inbox_tool,
    create_list_tasks_tool,
    create_search_messages_tool,
)
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

WORKSPACE_AGENT_NAME = "workspace_agent"
# Same model as the parent coach. Flash is fast enough for triage and
# already on Vertex location=global. Re-evaluate vs Flash Lite after
# dogfood telemetry lands.
WORKSPACE_AGENT_MODEL = "gemini-3-flash-preview"

WORKSPACE_AGENT_INSTRUCTION = (
    "You are a sub-agent for Google Workspace (Gmail, Calendar, Google Tasks).\n\n"
    "You receive a query from the parent coach agent. Use your tools to gather "
    "the data needed and return a clean, structured answer matching the schema "
    "requested in the query.\n\n"
    "Rules:\n"
    "- Read-only: never write or modify Workspace data. (Write tools are not in "
    "the active toolset for triage/find; only call them if the parent's "
    "invocation explicitly authorises a write.)\n"
    "- Do not ask the user questions; the parent agent owns conversation. Return "
    "your answer in the requested format and stop.\n"
    "- Be terse. The parent agent will paraphrase what you return.\n"
    "- When the query asks for a TRIAGE_REPORT or other markered JSON, emit it "
    "inside <TRIAGE_REPORT>...minified JSON...</TRIAGE_REPORT> tags exactly. "
    "Do not pretty-print; minified JSON is fine.\n"
    "- If a tool call returns status:'error', incorporate the error into your "
    "final answer (the parent agent maps error codes to user-facing messages)."
)

_DEFAULT_DESCRIPTION = (
    "Reads the user's Google Workspace data (Gmail / Calendar / Tasks) and "
    "returns structured answers."
)


def create_workspace_agent(
    *,
    deps: WorkspaceToolDeps,
    name: str = WORKSPACE_AGENT_NAME,
    description: str = _DEFAULT_DESCRIPTION,
    instruction: str = WORKSPACE_AGENT_INSTRUCTION,
    model: str = WORKSPACE_AGENT_MODEL,
    input_schema: type[BaseModel] | None = None,
    include_writes: bool = False,
) -> LlmAgent:
    """Build a sub-agent. `include_writes` is False for triage/find
    (read-only) and True if a future prompt wants the sub-agent to act
    inline."""
    tools = _build_read_tools(deps)
    if include_writes:
        tools = tools + _build_write_tools(deps)

    kwargs: dict[str, Any] = {
        "name": name,
        "model": model,
        "description": description,
        "instruction": instruction,
        "tools": tools,
        "disallow_transfer_to_parent": True,
        "disallow_transfer_to_peers": True,
    }
    if input_schema is not None:
        kwargs["input_schema"] = input_schema
    return LlmAgent(**kwargs)


def _build_read_tools(deps: WorkspaceToolDeps) -> list[Any]:
    return [
        create_list_inbox_tool(deps),
        create_get_message_tool(deps),
        create_search_messages_tool(deps),
        create_list_events_tool(deps),
        create_list_tasks_tool(deps),
    ]


def _build_write_tools(deps: WorkspaceToolDeps) -> list[Any]:
    return [
        create_archive_messages_tool(deps),
        create_add_calendar_event_tool(deps),
        create_add_task_tool(deps),
        create_complete_task_tool(deps),
        create_create_draft_email_tool(deps),
    ]
