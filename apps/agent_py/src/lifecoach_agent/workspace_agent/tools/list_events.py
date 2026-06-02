"""`list_events` — Google Calendar events in a time window. Each event
passes through `project_calendar_event` to drop the API bloat.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_calendar_event
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

LIST_EVENTS_TOOL_NAME = "list_events"


def create_list_events_tool(deps: WorkspaceToolDeps) -> Any:
    async def list_events(
        timeMin: str, timeMax: str, calendarId: str = "primary"
    ) -> dict[str, Any]:  # noqa: N803 — wire camelCase preserved for parity
        """List Google Calendar events in [timeMin, timeMax). Returns
        projected event shapes (title, start/end, location, attendees,
        link). Read-only.

        Args:
            timeMin: RFC3339 lower bound — e.g. "2026-05-12T00:00:00+01:00".
            timeMax: RFC3339 upper bound (exclusive). Pair with timeMin
                to define a window.
            calendarId: Calendar id. Default "primary".
        """
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=LIST_EVENTS_TOOL_NAME,
            service="calendar",
            resource="events",
            method="list",
            params={
                "calendarId": calendarId,
                "timeMin": timeMin,
                "timeMax": timeMax,
                "singleEvents": True,
                "orderBy": "startTime",
            },
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        body = result.body if isinstance(result.body, dict) else {}
        events = [
            project_calendar_event(item, calendarId).model_dump(by_alias=True, exclude_none=True)
            for item in (body.get("items") or [])
            if isinstance(item, dict)
        ]
        out: dict[str, Any] = {"status": "ok", "events": events}
        if result.truncated:
            out["truncated"] = True
        return out

    from google.adk.tools.function_tool import FunctionTool

    list_events.__name__ = LIST_EVENTS_TOOL_NAME
    return FunctionTool(list_events)
