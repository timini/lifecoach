"""Notion sub-agent module.

Public surface:
- :class:`NotionModuleDeps` — closes-over the per-uid stores, http
  client, and log hook needed by the tool implementations.
- :func:`create_notion_tools` — main agent factory. Returns the list
  of tools the parent agent sees: one AgentTool for the multi-step
  review + four narrow FunctionTool writes.
- :data:`NOTION_TOOL_NAMES` — drift-test target.

The connect UI directive (`connect_notion`) and the capability picker
(`show_capabilities`) live outside this module under
`lifecoach_agent.tools.*` because they're orthogonal to the Notion-
connected capability.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from lifecoach_agent.notion_agent.run_notion import LogEmitter
from lifecoach_agent.storage.notion_config import NotionConfigStore
from lifecoach_agent.storage.notion_tokens import NotionTokensStore

NOTION_TOOL_NAMES: tuple[str, ...] = (
    "notion_review_tasks",
    "add_notion_task",
    "update_notion_task",
    "set_notion_task_parent",
    "complete_notion_task",
)


@dataclass(frozen=True)
class NotionModuleDeps:
    """Per-request closure that every Notion tool depends on. Built in
    `main.runner_for` once per /chat turn and passed verbatim into
    `create_notion_tools()`."""

    store: NotionTokensStore
    config_store: NotionConfigStore
    uid: str
    http: httpx.AsyncClient | None = None
    log: LogEmitter | None = None


def create_notion_tools(deps: NotionModuleDeps) -> list[Any]:
    """Returns the Notion tool surface visible to the main agent.

    Order matters only for prompt cheatsheet readability; the LLM picks
    tools by name. We return them in the same order the
    NOTION_CHEATSHEET enumerates them so logs read consistently.
    """
    # Imports are intentionally local so the module can be partially
    # loaded by tests that only need the dataclasses without dragging
    # in ADK / google-adk imports.
    from lifecoach_agent.notion_agent.agent_tools.notion_review_tasks import (  # noqa: PLC0415
        create_notion_review_tasks_tool,
    )
    from lifecoach_agent.notion_agent.tools.add_notion_task import (  # noqa: PLC0415
        create_add_notion_task_tool,
    )
    from lifecoach_agent.notion_agent.tools.complete_notion_task import (  # noqa: PLC0415
        create_complete_notion_task_tool,
    )
    from lifecoach_agent.notion_agent.tools.set_notion_task_parent import (  # noqa: PLC0415
        create_set_notion_task_parent_tool,
    )
    from lifecoach_agent.notion_agent.tools.update_notion_task import (  # noqa: PLC0415
        create_update_notion_task_tool,
    )

    return [
        create_notion_review_tasks_tool(deps),
        create_add_notion_task_tool(deps),
        create_update_notion_task_tool(deps),
        create_set_notion_task_parent_tool(deps),
        create_complete_notion_task_tool(deps),
    ]
