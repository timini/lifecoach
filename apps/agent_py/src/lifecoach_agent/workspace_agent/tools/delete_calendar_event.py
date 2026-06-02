"""`delete_calendar_event` — single-step calendar.events.delete."""

from __future__ import annotations

from typing import Any, Literal

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

DELETE_CALENDAR_EVENT_TOOL_NAME = "delete_calendar_event"
SendUpdates = Literal["all", "externalOnly", "none"]


def create_delete_calendar_event_tool(deps: WorkspaceToolDeps) -> Any:
    async def delete_calendar_event(
        eventId: str,  # noqa: N803
        calendarId: str = "primary",  # noqa: N803
        sendUpdates: SendUpdates = "all",  # noqa: N803
    ) -> dict[str, Any]:
        """Delete an existing Google Calendar event. Use after the user
        confirms deletion (e.g. via ask_single_choice_question).

        Args:
            eventId: Existing Calendar event id. Use `find_workspace` or
                calendar lookup results to identify the event before deleting.
            calendarId: Calendar id. Default "primary".
            sendUpdates: Google Calendar notification behavior. Default
                "all" so attendees are told the event was cancelled.
        """
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=DELETE_CALENDAR_EVENT_TOOL_NAME,
            service="calendar",
            resource="events",
            method="delete",
            params={"calendarId": calendarId, "eventId": eventId, "sendUpdates": sendUpdates},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        return {"status": "ok", "deleted": eventId, "calendarId": calendarId}

    from google.adk.tools import FunctionTool  # type: ignore[attr-defined]

    delete_calendar_event.__name__ = DELETE_CALENDAR_EVENT_TOOL_NAME
    return FunctionTool(delete_calendar_event)
