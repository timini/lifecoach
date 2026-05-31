"""Project raw `calendar.calendarList.list` entries into the compact
shape the workspace sub-agent needs when choosing a calendar.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import CalendarListEntryProjection


def project_calendar_list_entry(raw: dict[str, Any]) -> CalendarListEntryProjection:
    """Keep only stable, user-facing fields from a CalendarList entry."""
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
