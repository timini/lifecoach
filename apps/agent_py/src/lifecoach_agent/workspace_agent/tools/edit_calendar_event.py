"""`edit_calendar_event` — single-step calendar.events.patch.

Only fields explicitly provided by the LLM are sent to Google Calendar.
Use after the user confirms an edit to an existing event.
"""

from __future__ import annotations

import re
from typing import Any

from lifecoach_agent.workspace_agent.projections import project_calendar_event
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

EDIT_CALENDAR_EVENT_TOOL_NAME = "edit_calendar_event"
_ALL_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def create_edit_calendar_event_tool(deps: WorkspaceToolDeps) -> Any:
    async def edit_calendar_event(
        id: str,  # noqa: A002 — Google Calendar wire name is "id".
        summary: str | None = None,
        start: str | None = None,
        end: str | None = None,
        location: str | None = None,
        description: str | None = None,
        attendees: list[str] | None = None,
        calendarId: str = "primary",  # noqa: N803
        sendUpdates: str = "all",  # noqa: N803
    ) -> dict[str, Any]:
        """Edit an existing Google Calendar event. Use the event id from
        find_workspace/list_events, and ask the user to confirm before
        calling unless they already approved the edit in this turn.
        Returns the updated event.

        Args:
            id: Google Calendar event id (without the "ev:" display prefix).
            summary: Optional replacement event title.
            start: Optional RFC3339 start timestamp with timezone offset, or
                YYYY-MM-DD for an all-day event.
            end: Optional RFC3339 end timestamp with timezone offset, or
                YYYY-MM-DD for an all-day event.
            location: Optional replacement location. Use an empty string to clear.
            description: Optional replacement description/notes. Use an empty
                string to clear.
            attendees: Optional full desired attendee email list. Calendar patch
                replaces attendee arrays, so include existing attendees that
                should remain plus any new ones.
            calendarId: Calendar id. Default "primary".
            sendUpdates: Calendar notification mode: "all", "externalOnly", or
                "none". Default "all" so attendee changes notify invitees.
        """
        request_body: dict[str, Any] = {}
        if summary is not None:
            request_body["summary"] = summary
        if start is not None:
            request_body["start"] = _time_block(start)
        if end is not None:
            request_body["end"] = _time_block(end)
        if location is not None:
            request_body["location"] = location
        if description is not None:
            request_body["description"] = description
        if attendees is not None:
            request_body["attendees"] = [{"email": email} for email in attendees if email]

        if not request_body:
            return {
                "status": "error",
                "code": "invalid_args",
                "message": "provide at least one event field to edit",
            }

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=EDIT_CALENDAR_EVENT_TOOL_NAME,
            service="calendar",
            resource="events",
            method="patch",
            params={"calendarId": calendarId, "eventId": id, "sendUpdates": sendUpdates},
            body=request_body,
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        raw = result.body if isinstance(result.body, dict) else {}
        projection = project_calendar_event(raw, calendarId)
        return {"status": "ok", "event": projection.model_dump(by_alias=True, exclude_none=True)}

    from google.adk.tools import FunctionTool

    edit_calendar_event.__name__ = EDIT_CALENDAR_EVENT_TOOL_NAME
    return FunctionTool(edit_calendar_event)


def _time_block(value: str) -> dict[str, str]:
    if _ALL_DAY_RE.match(value):
        return {"date": value}
    return {"dateTime": value}
