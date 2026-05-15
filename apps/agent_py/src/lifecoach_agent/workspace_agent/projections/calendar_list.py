"""Project raw `calendar.calendarList.list` entries into compact calendar
metadata for the workspace sub-agent.

Calendar list entries include many UI/sync fields the model does not need
(color ids, notifications, selected flags, etags). Keep only the fields that
help a user choose the right calendar and reuse its id later.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import CalendarListEntryProjection


def project_calendar_list_entry(raw: dict[str, Any]) -> CalendarListEntryProjection:
    payload: dict[str, Any] = {
        "id": raw.get("id") or "",
        "summary": raw.get("summary") or "(no title)",
        "primary": bool(raw.get("primary")),
        "accessRole": raw.get("accessRole") or "unknown",
        "timeZone": raw.get("timeZone") or "",
    }
    if raw.get("description"):
        payload["description"] = raw["description"]
    return CalendarListEntryProjection.model_validate(payload)
