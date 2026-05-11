"""`add_calendar_event` — single-step calendar.events.insert. Defaults
`end` to start + 30 min if omitted; defaults calendarId to "primary".
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from lifecoach_agent.workspace_agent.projections import project_calendar_event
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

ADD_CALENDAR_EVENT_TOOL_NAME = "add_calendar_event"
_DEFAULT_DURATION_MIN = 30
_ALL_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def create_add_calendar_event_tool(deps: WorkspaceToolDeps) -> Any:
    async def add_calendar_event(
        summary: str,
        start: str,
        end: str | None = None,
        location: str | None = None,
        description: str | None = None,
        calendarId: str = "primary",  # noqa: N803
    ) -> dict[str, Any]:
        """Add a single event to the user's Google Calendar. Use after
        the user confirms (e.g. via ask_single_choice_question). Returns
        the created event.

        Args:
            summary: Event title — what shows up on the calendar.
            start: RFC3339 start timestamp with timezone offset
                (e.g. "2026-05-12T18:00:00+01:00"), or YYYY-MM-DD for an
                all-day event.
            end: RFC3339 end (or YYYY-MM-DD all-day). Default =
                start + 30 minutes.
            location: Optional event location.
            description: Optional event description / notes.
            calendarId: Calendar id. Default "primary".
        """
        is_all_day = bool(_ALL_DAY_RE.match(start))
        start_block = {"date": start} if is_all_day else {"dateTime": start}

        if end:
            end_block = {"date": end} if is_all_day else {"dateTime": end}
        elif is_all_day:
            end_block = {"date": _add_days_iso(start, 1)}
        else:
            end_block = {"dateTime": _add_minutes(start, _DEFAULT_DURATION_MIN)}

        request_body: dict[str, Any] = {
            "summary": summary,
            "start": start_block,
            "end": end_block,
        }
        if location:
            request_body["location"] = location
        if description:
            request_body["description"] = description

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=ADD_CALENDAR_EVENT_TOOL_NAME,
            service="calendar",
            resource="events",
            method="insert",
            params={"calendarId": calendarId},
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

    add_calendar_event.__name__ = ADD_CALENDAR_EVENT_TOOL_NAME
    return FunctionTool(add_calendar_event)


def _add_days_iso(yyyy_mm_dd: str, days: int) -> str:
    try:
        d = datetime.fromisoformat(f"{yyyy_mm_dd}T00:00:00+00:00")
    except ValueError:
        return yyyy_mm_dd
    return (d + timedelta(days=days)).date().isoformat()


def _add_minutes(rfc3339: str, minutes: int) -> str:
    try:
        ts = datetime.fromisoformat(rfc3339.replace("Z", "+00:00"))
    except ValueError:
        return rfc3339
    out = ts + timedelta(minutes=minutes)
    # Preserve the original input's offset rendering style.
    if rfc3339.endswith("Z"):
        return out.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out.isoformat()
