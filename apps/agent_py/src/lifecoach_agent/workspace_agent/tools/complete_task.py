"""`complete_task` — mark a Google Task as completed via tasks.patch."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_task
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

COMPLETE_TASK_TOOL_NAME = "complete_task"


def create_complete_task_tool(deps: WorkspaceToolDeps) -> Any:
    async def complete_task(
        id: str,
        taskListId: str = "@default",  # noqa: N803
    ) -> dict[str, Any]:
        """Mark a Google Task as completed. Use when the user says they
        finished an item from list_tasks or a triage action.

        Args:
            id: Task id (from list_tasks).
            taskListId: Task list id. Default "@default".
        """
        # tasks.update is a PUT requiring the FULL task resource — sending
        # only {id, status} would wipe title/notes/due. tasks.patch is
        # the partial-update endpoint for a single-field flip.
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=COMPLETE_TASK_TOOL_NAME,
            service="tasks",
            resource="tasks",
            method="patch",
            params={"tasklist": taskListId, "task": id},
            body={"status": "completed"},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        raw = result.body if isinstance(result.body, dict) else {}
        projection = project_task(raw, taskListId)
        return {"status": "ok", "task": projection.model_dump(by_alias=True, exclude_none=True)}

    from google.adk.tools import FunctionTool

    complete_task.__name__ = COMPLETE_TASK_TOOL_NAME
    return FunctionTool(complete_task)
