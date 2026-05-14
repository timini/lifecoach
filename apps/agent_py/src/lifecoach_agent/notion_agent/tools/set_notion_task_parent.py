"""`set_notion_task_parent` — re-parent a task under a project parent
task (or unparent to top level)."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.notion_agent.projections import project_notion_task
from lifecoach_agent.notion_agent.run_notion import RunNotionErr, RunNotionOk, run_notion
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps
from lifecoach_agent.notion_agent.tools._properties import PROP_PARENT, relation_property

SET_NOTION_TASK_PARENT_TOOL_NAME = "set_notion_task_parent"


def create_set_notion_task_parent_tool(deps: NotionToolDeps) -> Any:
    async def set_notion_task_parent(
        id: str,  # noqa: A002 — LLM-facing param name
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        """Re-parent a task. `parent_id` null clears the relation —
        the task moves to top level under its Project bucket."""
        if not id or not isinstance(id, str):
            return {"status": "error", "code": "bad_request", "message": "id required"}

        properties = {PROP_PARENT: relation_property([parent_id] if parent_id else [])}
        result = await run_notion(
            store=deps.store,
            uid=deps.uid,
            tool_name=SET_NOTION_TASK_PARENT_TOOL_NAME,
            method="PATCH",
            path=f"/v1/pages/{id}",
            body={"properties": properties},
            http=deps.http,
            log=deps.log,
        )
        if isinstance(result, RunNotionErr):
            return {"status": "error", "code": result.code, "message": result.message}
        assert isinstance(result, RunNotionOk)
        page = result.body if isinstance(result.body, dict) else {}
        return {"status": "ok", "task": project_notion_task(page).model_dump()}

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    set_notion_task_parent.__name__ = SET_NOTION_TASK_PARENT_TOOL_NAME
    return FunctionTool(set_notion_task_parent)
