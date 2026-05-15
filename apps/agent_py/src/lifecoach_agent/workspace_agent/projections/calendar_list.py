"""Project raw ``calendar.calendarList.list`` entries into the small shape
consumed by the workspace-search sub-agent.

Google Calendar list entries include many UI and notification fields the
LLM does not need. Keep only enough metadata for the user/model to choose
the right calendar for future event writes.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import CalendarListEntryProjection


def project_calendar_list_entry(raw: dict[str, Any]) -> CalendarListEntryProjection:
    payload: dict[str, Any] = {
        "id": raw.get("id") or "",
        "summary": raw.get("summary") or "(no title)",
        "primary": raw.get("primary") is True,
        "accessRole": raw.get("accessRole") or "unknown",
        "timeZone": raw.get("timeZone") or "",
    }
    if raw.get("description"):
        payload["description"] = raw["description"]
    return CalendarListEntryProjection.model_validate(payload)
