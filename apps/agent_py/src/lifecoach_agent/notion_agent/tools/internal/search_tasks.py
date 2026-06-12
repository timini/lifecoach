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
    async def search_tasks(query: str, limit: int = 100) -> dict[str, Any]:
        """Find tasks whose title or notes contain `query` (case-
        insensitive). Read-only. Use this for the LLM's "find that
        thing about X" lookups. Pages through Notion (100/page) up to
        `limit` matches so large result sets aren't silently truncated."""
        if not query or not isinstance(query, str):
            return {"status": "error", "code": "bad_request", "message": "query required"}

        try:
            db_id = await get_or_create_database(deps)
        except DatabaseUnavailableError as err:
            return {"status": "error", "code": err.code, "message": str(err)}

        target = max(1, min(int(limit), 300))
        flt = {
            "or": [
                {"property": "Task", "title": {"contains": query}},
                {"property": "Notes", "rich_text": {"contains": query}},
            ]
        }

        collected: list[dict[str, Any]] = []
        cursor: str | None = None
        has_more = False
        truncated = False
        while len(collected) < target:
            body: dict[str, Any] = {
                "page_size": min(target - len(collected), 100),
                "filter": flt,
                "sorts": [{"timestamp": "last_edited_time", "direction": "descending"}],
            }
            if cursor:
                body["start_cursor"] = cursor

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
            collected.extend(p for p in (payload.get("results") or []) if isinstance(p, dict))
            truncated = truncated or result.truncated

            next_cursor = payload.get("next_cursor")
            if payload.get("has_more") and isinstance(next_cursor, str) and next_cursor:
                cursor = next_cursor
                has_more = True
            else:
                has_more = False
                break

        tasks = [project_notion_task(p).model_dump() for p in collected[:target]]
        return {
            "status": "ok",
            "tasks": tasks,
            "hasMore": has_more or len(collected) > target,
            "truncated": truncated,
        }

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    search_tasks.__name__ = SEARCH_TASKS_TOOL_NAME
    return FunctionTool(search_tasks)
