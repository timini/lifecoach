"""Notion sub-agent — Flash-backed LlmAgent with narrow read-only
tools. Wrapped by the `notion_review_tasks` AgentTool the main coach
sees.

The four write tools live on the main agent's surface (see
`notion_agent/__init__.create_notion_tools`), not in the sub-agent's
toolset, so writes never go through the extra LLM hop and stay tight
to the parent's confirmation flow.
"""

from __future__ import annotations

from typing import Any

from google.adk.agents import LlmAgent
from pydantic import BaseModel

from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps
from lifecoach_agent.notion_agent.tools.internal import (
    create_get_task_tool,
    create_list_tasks_tool,
    create_search_tasks_tool,
)

NOTION_AGENT_NAME = "notion_agent"
NOTION_AGENT_MODEL = "gemini-3-flash-preview"

NOTION_AGENT_INSTRUCTION = (
    "You are a sub-agent for the user's Notion tasks workspace.\n\n"
    "The parent coach hands you a query. Use your tools to gather the data and "
    "return a clean structured answer matching the schema requested in the query.\n\n"
    "Rules:\n"
    "- Read-only. You do NOT have write tools — even when the data screams 'add a "
    "task', the parent agent owns the write decision.\n"
    "- Do not ask the user questions; the parent agent owns conversation. Return "
    "your answer in the requested format and stop.\n"
    "- Be terse. The parent will paraphrase what you return.\n"
    "- When the query asks for a NOTION_REVIEW report, emit it inside "
    "<NOTION_REVIEW>...minified JSON...</NOTION_REVIEW> tags exactly. Do not "
    "pretty-print; minified JSON is fine.\n"
    "- If a tool call returns status:'error', incorporate the error code into "
    "the marker so the parent's mapping fires."
)

_DEFAULT_DESCRIPTION = (
    "Reads the user's Notion tasks workspace and returns structured task "
    "reports (project-bucketed, parent-nested trees)."
)


def create_notion_agent(
    *,
    deps: NotionToolDeps,
    name: str = NOTION_AGENT_NAME,
    description: str = _DEFAULT_DESCRIPTION,
    instruction: str = NOTION_AGENT_INSTRUCTION,
    model: str = NOTION_AGENT_MODEL,
    input_schema: type[BaseModel] | None = None,
) -> LlmAgent:
    """Build the Notion sub-agent. Always read-only — writes are on the
    main agent's surface."""
    tools = _build_read_tools(deps)

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


def _build_read_tools(deps: NotionToolDeps) -> list[Any]:
    return [
        create_list_tasks_tool(deps),
        create_get_task_tool(deps),
        create_search_tasks_tool(deps),
    ]
