"""``list_calendars`` — enumerate the user's Google Calendar list.

Use this for direct calendar-list / calendar-id questions. It calls
``calendar.calendarList.list`` and projects each entry to the fields
needed to choose the right calendar.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_calendar_list_entry
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

LIST_CALENDARS_TOOL_NAME = "list_calendars"


def create_list_calendars_tool(deps: WorkspaceToolDeps) -> Any:
    async def list_calendars(limit: int = 250) -> dict[str, Any]:
        """List Google Calendars available to the user, including shared
        calendars. Returns id, summary, primary, accessRole, timeZone,
        and description when present. Read-only.

        Args:
            limit: Maximum calendars to return (1–250). Default 250.
        """
        max_results = max(1, min(int(limit), 250))
        calendars: list[dict[str, Any]] = []
        page_token: str | None = None
        truncated = False

        while len(calendars) < max_results:
            page_size = min(250, max_results - len(calendars))
            params: dict[str, Any] = {"maxResults": page_size}
            if page_token:
                params["pageToken"] = page_token

            result = await run_gws(
                store=deps.store,
                uid=deps.uid,
                tool_name=LIST_CALENDARS_TOOL_NAME,
                service="calendar",
                resource="calendarList",
                method="list",
                params=params,
                build_client=deps.build_client,
                log=deps.log,
            )
            if not isinstance(result, RunGwsOk):
                return {"status": "error", "code": result.code, "message": result.message}

            body = result.body if isinstance(result.body, dict) else {}
            calendars.extend(
                project_calendar_list_entry(item).model_dump(by_alias=True, exclude_none=True)
                for item in (body.get("items") or [])
                if isinstance(item, dict)
            )
            truncated = truncated or result.truncated
            next_token = body.get("nextPageToken")
            page_token = next_token if isinstance(next_token, str) and next_token else None
            if page_token is None:
                break

        out: dict[str, Any] = {"status": "ok", "calendars": calendars[:max_results]}
        if truncated or page_token is not None:
            out["truncated"] = True
        return out

    from google.adk.tools import FunctionTool

    list_calendars.__name__ = LIST_CALENDARS_TOOL_NAME
    return FunctionTool(list_calendars)
