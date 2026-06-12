"""Internal Notion read tools — bound to the sub-agent only, never
exposed to the parent / main agent.

The sub-agent uses these to assemble the project-bucketed tree the
parent's `notion_review_tasks` AgentTool surfaces. Reads are
intentionally cheap and structured so the LLM never has to slice raw
Notion responses.
"""

from __future__ import annotations

from lifecoach_agent.notion_agent.tools.internal.get_task import (
    GET_TASK_TOOL_NAME,
    create_get_task_tool,
)
from lifecoach_agent.notion_agent.tools.internal.list_tasks import (
    LIST_TASKS_TOOL_NAME,
    create_list_tasks_tool,
)
from lifecoach_agent.notion_agent.tools.internal.search_tasks import (
    SEARCH_TASKS_TOOL_NAME,
    create_search_tasks_tool,
)

__all__ = [
    "GET_TASK_TOOL_NAME",
    "LIST_TASKS_TOOL_NAME",
    "SEARCH_TASKS_TOOL_NAME",
    "create_get_task_tool",
    "create_list_tasks_tool",
    "create_search_tasks_tool",
]
