"""`search_tasks` — sub-agent internal read. Text contains-match on
title and notes."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.notion_agent.database_bootstrap import (
    DatabaseUnavailableError,
    clear_database_id_on_not_found,
    get_or_create_database,
)
from lifecoach_agent.notion_agent.projections import project_notion_task
from lifecoach_agent.notion_agent.run_notion import RunNotionErr, RunNotionOk, run_notion
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps

SEARCH_TASKS_TOOL_NAME = "search_tasks"


def create_search_tasks_tool(deps: NotionToolDeps) -> Any:
    async def search_tasks(query: str, limit: int = 25) -> dict[str, Any]:
        """Find tasks whose title or notes contain `query` (case-
        insensitive). Read-only. Use this for the LLM's "find that
        thing about X" lookups."""
        if not query or not isinstance(query, str):
            return {"status": "error", "code": "bad_request", "message": "query required"}

        try:
            db_id = await get_or_create_database(deps)
        except DatabaseUnavailableError as err:
            return {"status": "error", "code": err.code, "message": str(err)}

        body = {
            "page_size": max(1, min(int(limit), 100)),
            "filter": {
                "or": [
                    {"property": "Task", "title": {"contains": query}},
                    {"property": "Notes", "rich_text": {"contains": query}},
                ]
            },
            "sorts": [{"timestamp": "last_edited_time", "direction": "descending"}],
        }

        result = await run_notion(
            store=deps.store,
            uid=deps.uid,
            tool_name=SEARCH_TASKS_TOOL_NAME,
            method="POST",
            path=f"/v1/databases/{db_id}/query",
            body=body,
            http=deps.http,
            log=deps.log,
        )

        if isinstance(result, RunNotionErr):
            if result.code == "not_found":
                await clear_database_id_on_not_found(deps)
            return {"status": "error", "code": result.code, "message": result.message}

        assert isinstance(result, RunNotionOk)
        payload = result.body if isinstance(result.body, dict) else {}
        raw = payload.get("results") or []
        tasks = [project_notion_task(p).model_dump() for p in raw if isinstance(p, dict)]
        return {
            "status": "ok",
            "tasks": tasks,
            "hasMore": bool(payload.get("has_more")),
            "truncated": result.truncated,
        }

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    search_tasks.__name__ = SEARCH_TASKS_TOOL_NAME
    return FunctionTool(search_tasks)
