"""`list_tasks` — Google Tasks list, filtered to needsAction by default."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_task
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

LIST_TASKS_TOOL_NAME = "list_tasks"


def create_list_tasks_tool(deps: WorkspaceToolDeps) -> Any:
    async def list_tasks(
        taskListId: str = "@default", showCompleted: bool = False
    ) -> dict[str, Any]:  # noqa: N803
        """List Google Tasks in a task list. Returns projected task
        shapes (title, due, status, notes). Read-only.

        Args:
            taskListId: Task list id. Default "@default".
            showCompleted: Include completed tasks. Default false.
        """
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=LIST_TASKS_TOOL_NAME,
            service="tasks",
            resource="tasks",
            method="list",
            params={"tasklist": taskListId, "showCompleted": showCompleted},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        body = result.body if isinstance(result.body, dict) else {}
        tasks = [
            project_task(item, taskListId).model_dump(by_alias=True, exclude_none=True)
            for item in (body.get("items") or [])
            if isinstance(item, dict)
        ]
        out: dict[str, Any] = {"status": "ok", "tasks": tasks}
        if result.truncated:
            out["truncated"] = True
        return out

    from google.adk.tools.function_tool import FunctionTool

    list_tasks.__name__ = LIST_TASKS_TOOL_NAME
    return FunctionTool(list_tasks)
