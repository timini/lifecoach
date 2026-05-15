"""`list_calendars` — Google Calendar calendar-list metadata.

Uses `calendar.calendarList.list` rather than Gmail or event search so direct
calendar-ID requests can enumerate the user's calendars reliably.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_calendar_list_entry
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

LIST_CALENDARS_TOOL_NAME = "list_calendars"


def create_list_calendars_tool(deps: WorkspaceToolDeps) -> Any:
    async def list_calendars() -> dict[str, Any]:
        """List Google Calendar calendars the user can access. Returns compact
        calendar metadata: id, summary, primary flag, accessRole, timeZone,
        and description when present. Use this for requests like "list my
        calendars", "show calendar IDs", or "find my Family calendar id".
        Do not search Gmail for calendar-list requests unless the user
        explicitly asks to search messages.
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

    from google.adk.tools import FunctionTool

    list_calendars.__name__ = LIST_CALENDARS_TOOL_NAME
    return FunctionTool(list_calendars)
