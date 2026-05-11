"""`add_task` — single-step Google Tasks insert."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_task
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

ADD_TASK_TOOL_NAME = "add_task"


def create_add_task_tool(deps: WorkspaceToolDeps) -> Any:
    async def add_task(
        title: str,
        due: str | None = None,
        notes: str | None = None,
        taskListId: str = "@default",  # noqa: N803
    ) -> dict[str, Any]:
        """Add a task to the user's Google Tasks. Use after surfacing an
        action from triage_inbox or when the user explicitly asks to add
        a task. Returns the created task.

        Args:
            title: Task title.
            due: Optional RFC3339 due date — Google Tasks treats this as
                a date-only value.
            notes: Optional task notes.
            taskListId: Task list id. Default "@default".
        """
        request_body: dict[str, Any] = {"title": title}
        if due:
            request_body["due"] = due
        if notes:
            request_body["notes"] = notes

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=ADD_TASK_TOOL_NAME,
            service="tasks",
            resource="tasks",
            method="insert",
            params={"tasklist": taskListId},
            body=request_body,
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        raw = result.body if isinstance(result.body, dict) else {}
        projection = project_task(raw, taskListId)
        return {"status": "ok", "task": projection.model_dump(by_alias=True, exclude_none=True)}

    from google.adk.tools import FunctionTool

    add_task.__name__ = ADD_TASK_TOOL_NAME
    return FunctionTool(add_task)
