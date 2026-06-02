"""`edit_calendar_event` — update an existing Google Calendar event.

Uses calendar.events.patch so callers can provide only the fields that
changed. For attendee additions, the tool first fetches the current event
and merges `addAttendees` with any existing attendee list so adding one
person does not accidentally remove the others.
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
        eventId: str,  # noqa: N803
        summary: str | None = None,
        start: str | None = None,
        end: str | None = None,
        location: str | None = None,
        description: str | None = None,
        addAttendees: list[str] | None = None,  # noqa: N803
        calendarId: str = "primary",  # noqa: N803
    ) -> dict[str, Any]:
        """Edit an existing Google Calendar event after user confirmation.

        Args:
            eventId: Google Calendar event id, typically from list_events or
                find_workspace (`ev:<id>` citations should pass the raw id).
            summary: Optional replacement title.
            start: Optional replacement start, RFC3339 timestamp with timezone
                offset or YYYY-MM-DD for an all-day event.
            end: Optional replacement end, matching `start` format when both
                are supplied.
            location: Optional replacement location. Empty string clears it.
            description: Optional replacement notes. Empty string clears them.
            addAttendees: Optional email addresses to add without removing
                existing attendees.
            calendarId: Calendar id. Default "primary".
        """
        request_body: dict[str, Any] = {}
        if summary is not None:
            request_body["summary"] = summary
        if start is not None:
            request_body["start"] = _calendar_time_block(start)
        if end is not None:
            request_body["end"] = _calendar_time_block(end)
        if location is not None:
            request_body["location"] = location
        if description is not None:
            request_body["description"] = description

        attendees = _normalise_emails(addAttendees)
        if attendees:
            get_result = await run_gws(
                store=deps.store,
                uid=deps.uid,
                tool_name=EDIT_CALENDAR_EVENT_TOOL_NAME,
                service="calendar",
                resource="events",
                method="get",
                params={"calendarId": calendarId, "eventId": eventId},
                build_client=deps.build_client,
                log=deps.log,
            )
            if not isinstance(get_result, RunGwsOk):
                return {
                    "status": "error",
                    "code": get_result.code,
                    "message": get_result.message,
                }
            raw = get_result.body if isinstance(get_result.body, dict) else {}
            request_body["attendees"] = _merge_attendees(raw.get("attendees"), attendees)

        if not request_body:
            return {
                "status": "error",
                "code": "invalid_args",
                "message": "Provide at least one event field to edit.",
            }

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=EDIT_CALENDAR_EVENT_TOOL_NAME,
            service="calendar",
            resource="events",
            method="patch",
            params={"calendarId": calendarId, "eventId": eventId},
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


def _calendar_time_block(value: str) -> dict[str, str]:
    if _ALL_DAY_RE.match(value):
        return {"date": value}
    return {"dateTime": value}


def _normalise_emails(emails: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for email in emails or []:
        clean = email.strip()
        key = clean.lower()
        if clean and key not in seen:
            out.append(clean)
            seen.add(key)
    return out


def _merge_attendees(existing: Any, add_emails: list[str]) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[str] = set()
    for attendee in existing or []:
        if not isinstance(attendee, dict):
            continue
        email = attendee.get("email")
        if not isinstance(email, str) or not email:
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append({"email": email})
    for email in add_emails:
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append({"email": email})
    return merged
