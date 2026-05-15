"""`get_task` — sub-agent internal read. Fetch one task by id."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.notion_agent.projections import project_notion_task
from lifecoach_agent.notion_agent.run_notion import RunNotionErr, RunNotionOk, run_notion
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps

GET_TASK_TOOL_NAME = "get_task"


def create_get_task_tool(deps: NotionToolDeps) -> Any:
    async def get_task(id: str) -> dict[str, Any]:  # noqa: A002 — matches the LLM-facing param name
        """Fetch one Notion task page by id. Returns the flat
        projection (title, status, priority, project, due, notes,
        parentId, url, timestamps)."""
        if not id or not isinstance(id, str):
            return {"status": "error", "code": "bad_request", "message": "id required"}

        result = await run_notion(
            store=deps.store,
            uid=deps.uid,
            tool_name=GET_TASK_TOOL_NAME,
            method="GET",
            path=f"/v1/pages/{id}",
            http=deps.http,
            log=deps.log,
        )

        if isinstance(result, RunNotionErr):
            return {"status": "error", "code": result.code, "message": result.message}

        assert isinstance(result, RunNotionOk)
        page = result.body if isinstance(result.body, dict) else {}
        return {"status": "ok", "task": project_notion_task(page).model_dump()}

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    get_task.__name__ = GET_TASK_TOOL_NAME
    return FunctionTool(get_task)
