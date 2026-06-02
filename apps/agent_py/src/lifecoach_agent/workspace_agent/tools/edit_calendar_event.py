"""`edit_calendar_event` — single-step calendar.events.patch.

Use after the user confirms the exact change. The tool only patches
fields the caller supplies, so it can safely add attendees, rename an
event, or adjust time/location without clobbering unrelated fields.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from lifecoach_agent.workspace_agent.projections import project_calendar_event
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

EDIT_CALENDAR_EVENT_TOOL_NAME = "edit_calendar_event"
_ALL_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SendUpdates = Literal["all", "externalOnly", "none"]


def create_edit_calendar_event_tool(deps: WorkspaceToolDeps) -> Any:
    async def edit_calendar_event(
        eventId: str,  # noqa: N803
        summary: str | None = None,
        start: str | None = None,
        end: str | None = None,
        location: str | None = None,
        description: str | None = None,
        attendees: list[str] | None = None,
        calendarId: str = "primary",  # noqa: N803
        sendUpdates: SendUpdates = "all",  # noqa: N803
    ) -> dict[str, Any]:
        """Patch an existing Google Calendar event. Use after the user
        confirms the exact edit (e.g. via ask_single_choice_question).
        Returns the updated event.

        Args:
            eventId: Existing Calendar event id. Use `find_workspace` or
                calendar lookup results to identify the event before editing.
            summary: Optional replacement title.
            start: Optional RFC3339 start timestamp with timezone offset,
                or YYYY-MM-DD for an all-day event.
            end: Optional RFC3339 end timestamp, or YYYY-MM-DD for an
                all-day event. If start changes and end is omitted, the
                existing event end is preserved by Google Calendar.
            location: Optional replacement location. Pass an empty string
                to clear the location.
            description: Optional replacement notes/description. Pass an
                empty string to clear the description.
            attendees: Optional complete attendee email list. To add Laura,
                pass the existing attendees plus Laura's email so the list
                remains complete.
            calendarId: Calendar id. Default "primary".
            sendUpdates: Google Calendar notification behavior. Default
                "all" so newly added attendees receive an invite/update.
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
                "message": "Provide at least one field to edit.",
            }

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=EDIT_CALENDAR_EVENT_TOOL_NAME,
            service="calendar",
            resource="events",
            method="patch",
            params={"calendarId": calendarId, "eventId": eventId, "sendUpdates": sendUpdates},
            body=request_body,
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        raw = result.body if isinstance(result.body, dict) else {}
        projection = project_calendar_event(raw, calendarId)
        return {"status": "ok", "event": projection.model_dump(by_alias=True, exclude_none=True)}

    from google.adk.tools import FunctionTool  # type: ignore[attr-defined]

    edit_calendar_event.__name__ = EDIT_CALENDAR_EVENT_TOOL_NAME
    return FunctionTool(edit_calendar_event)


def _time_block(value: str) -> dict[str, str]:
    return {"date": value} if _ALL_DAY_RE.match(value) else {"dateTime": value}
