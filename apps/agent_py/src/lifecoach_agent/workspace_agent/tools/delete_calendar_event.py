"""`delete_calendar_event` — single-step calendar.events.delete."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

DELETE_CALENDAR_EVENT_TOOL_NAME = "delete_calendar_event"


def create_delete_calendar_event_tool(deps: WorkspaceToolDeps) -> Any:
    async def delete_calendar_event(
        id: str,  # noqa: A002 — Google Calendar wire name is "id".
        calendarId: str = "primary",  # noqa: N803
        sendUpdates: str = "all",  # noqa: N803
    ) -> dict[str, Any]:
        """Delete an existing Google Calendar event. Use the event id from
        find_workspace/list_events, and ask the user to confirm before
        calling unless they already approved deletion in this turn.

        Args:
            id: Google Calendar event id (without the "ev:" display prefix).
            calendarId: Calendar id. Default "primary".
            sendUpdates: Calendar notification mode: "all", "externalOnly", or
                "none". Default "all" so attendees learn about cancellations.
        """
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=DELETE_CALENDAR_EVENT_TOOL_NAME,
            service="calendar",
            resource="events",
            method="delete",
            params={"calendarId": calendarId, "eventId": id, "sendUpdates": sendUpdates},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        return {"status": "ok", "deleted": id, "calendarId": calendarId}

    from google.adk.tools import FunctionTool

    delete_calendar_event.__name__ = DELETE_CALENDAR_EVENT_TOOL_NAME
    return FunctionTool(delete_calendar_event)
