"""`list_calendars` — enumerate the user's Google Calendar list.

`calendar.calendarList.list` is paginated. We page through with a
conservative `maxResults` for two reasons:

  1. Large accounts: a single page would otherwise silently drop the
     calendars after the first ~100 entries, so "find the Family
     calendar ID" could report a real calendar as missing.
  2. The 32 KiB `run_gws` raw-response cap: calendar-list entries carry
     colour / reminder / conference metadata we throw away, so a big
     page can be truncated to an invalid-JSON string *before* we get to
     project it — which would surface as an empty list. Small pages keep
     each raw response well under the cap; we still surface `truncated`
     if a page is clipped rather than pretending the list is complete.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.workspace_agent.projections import project_calendar_list_entry
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

LIST_CALENDARS_TOOL_NAME = "list_calendars"

# Conservative page size: keeps each raw calendarList page comfortably
# below the 32 KiB run_gws cap while still being one round-trip for the
# common case (a handful of calendars).
_PAGE_SIZE = 50
# Hard stop so a misbehaving nextPageToken can't loop forever. 50 * 20 =
# 1000 calendars is already far past any real account.
_MAX_PAGES = 20


def create_list_calendars_tool(deps: WorkspaceToolDeps) -> Any:
    async def list_calendars() -> dict[str, Any]:
        """List Google Calendars available to the user. Returns compact
        calendar-list entries (id, summary, primary, accessRole,
        timeZone, optional description). Read-only.
        """
        calendars: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        page_token: str | None = None
        truncated = False

        for _ in range(_MAX_PAGES):
            params: dict[str, Any] = {"maxResults": _PAGE_SIZE}
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
            if result.truncated:
                truncated = True

            body = result.body if isinstance(result.body, dict) else {}
            for item in body.get("items") or []:
                if not isinstance(item, dict):
                    continue
                entry = project_calendar_list_entry(item).model_dump(
                    by_alias=True, exclude_none=True
                )
                if entry["id"] in seen_ids:
                    continue
                seen_ids.add(entry["id"])
                calendars.append(entry)

            next_token = body.get("nextPageToken")
            page_token = next_token if isinstance(next_token, str) and next_token else None
            if not page_token:
                break

        out: dict[str, Any] = {"status": "ok", "calendars": calendars}
        if truncated:
            out["truncated"] = True
        return out

    from google.adk.tools import FunctionTool  # type: ignore[attr-defined]

    list_calendars.__name__ = LIST_CALENDARS_TOOL_NAME
    return FunctionTool(list_calendars)
