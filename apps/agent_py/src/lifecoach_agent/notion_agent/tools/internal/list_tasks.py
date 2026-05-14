"""`list_tasks` — sub-agent internal read.

Queries the Lifecoach Tasks DB and returns a list of flat
NotionTaskProjections. Defaults to "open" tasks (status != Done) since
the review almost always wants what's open; the LLM can pass
`status=Done` for completion-recall queries.
"""

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

LIST_TASKS_TOOL_NAME = "list_tasks"

_OPEN_STATUSES = ["To Do", "In Progress", "Waiting"]


def _status_filter(status: str | None) -> dict[str, Any]:
    """Build a `databases.query` filter clause. None / "open" maps to
    the three non-Done statuses; a literal status filters to it; "all"
    bypasses the filter entirely."""
    if status is None or status.lower() == "open":
        return {"or": [{"property": "Status", "select": {"equals": s}} for s in _OPEN_STATUSES]}
    if status.lower() == "all":
        return {}
    return {"property": "Status", "select": {"equals": status}}


def create_list_tasks_tool(deps: NotionToolDeps) -> Any:
    async def list_tasks(
        status: str = "open",
        limit: int = 50,
    ) -> dict[str, Any]:
        """List tasks from the Lifecoach Tasks database.

        Args:
            status: One of "open" (default — To Do / In Progress /
                Waiting), "all", or a specific status literal.
            limit: Max tasks to return (1–100). Default 50.

        Returns:
            {status: "ok", tasks: [...], hasMore: bool}
            On error: {status: "error", code, message}
        """
        try:
            db_id = await get_or_create_database(deps)
        except DatabaseUnavailableError as err:
            return {"status": "error", "code": err.code, "message": str(err)}

        body: dict[str, Any] = {
            "page_size": max(1, min(int(limit), 100)),
            "sorts": [{"timestamp": "last_edited_time", "direction": "descending"}],
        }
        flt = _status_filter(status)
        if flt:
            body["filter"] = flt

        result = await run_notion(
            store=deps.store,
            uid=deps.uid,
            tool_name=LIST_TASKS_TOOL_NAME,
            method="POST",
            path=f"/v1/databases/{db_id}/query",
            body=body,
            http=deps.http,
            log=deps.log,
        )

        if isinstance(result, RunNotionErr):
            # If the stored db_id is gone, drop the cache so the next
            # call re-bootstraps under whatever pages are now granted.
            if result.code == "not_found":
                await clear_database_id_on_not_found(deps)
            return {"status": "error", "code": result.code, "message": result.message}

        assert isinstance(result, RunNotionOk)
        payload = result.body if isinstance(result.body, dict) else {}
        raw_pages = payload.get("results") or []
        tasks = [project_notion_task(p).model_dump() for p in raw_pages if isinstance(p, dict)]
        return {
            "status": "ok",
            "tasks": tasks,
            "hasMore": bool(payload.get("has_more")),
            "truncated": result.truncated,
        }

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    list_tasks.__name__ = LIST_TASKS_TOOL_NAME
    return FunctionTool(list_tasks)
