"""`delete_calendar_event` — remove an existing Google Calendar event."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

DELETE_CALENDAR_EVENT_TOOL_NAME = "delete_calendar_event"


def create_delete_calendar_event_tool(deps: WorkspaceToolDeps) -> Any:
    async def delete_calendar_event(
        eventId: str,  # noqa: N803
        calendarId: str = "primary",  # noqa: N803
    ) -> dict[str, Any]:
        """Delete an existing Google Calendar event after user confirmation.

        Args:
            eventId: Google Calendar event id, typically from list_events or
                find_workspace (`ev:<id>` citations should pass the raw id).
            calendarId: Calendar id. Default "primary".
        """
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=DELETE_CALENDAR_EVENT_TOOL_NAME,
            service="calendar",
            resource="events",
            method="delete",
            # sendUpdates=all so any attendees get the cancellation notice
            # rather than the meeting silently vanishing from their calendars.
            params={"calendarId": calendarId, "eventId": eventId, "sendUpdates": "all"},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        return {"status": "ok", "deleted": {"id": eventId, "calendarId": calendarId}}

    from google.adk.tools import FunctionTool  # type: ignore[attr-defined]

    delete_calendar_event.__name__ = DELETE_CALENDAR_EVENT_TOOL_NAME
    return FunctionTool(delete_calendar_event)
