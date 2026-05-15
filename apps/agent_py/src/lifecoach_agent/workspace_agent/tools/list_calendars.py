"""`list_calendars` — enumerate the user's Google Calendar list."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_calendar_list_entry
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

LIST_CALENDARS_TOOL_NAME = "list_calendars"


def create_list_calendars_tool(deps: WorkspaceToolDeps) -> Any:
    async def list_calendars() -> dict[str, Any]:
        """List Google Calendars available to the user. Returns compact
        calendar-list entries (id, summary, primary, accessRole,
        timeZone, optional description). Read-only.
        """
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=LIST_CALENDARS_TOOL_NAME,
            service="calendar",
            resource="calendarList",
            method="list",
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        body = result.body if isinstance(result.body, dict) else {}
        calendars = [
            project_calendar_list_entry(item).model_dump(by_alias=True, exclude_none=True)
            for item in (body.get("items") or [])
            if isinstance(item, dict)
        ]
        out: dict[str, Any] = {"status": "ok", "calendars": calendars}
        if result.truncated:
            out["truncated"] = True
        return out

    from google.adk.tools import FunctionTool  # type: ignore[attr-defined]

    list_calendars.__name__ = LIST_CALENDARS_TOOL_NAME
    return FunctionTool(list_calendars)
