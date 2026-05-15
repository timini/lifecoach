"""Project a raw ``calendar.calendarList.list`` item into the compact
shape the LLM needs when choosing a calendar.

The Google Calendar API returns colour settings, notification defaults,
conference properties, etags, and other metadata that are not needed for
answering "which calendar id should I use?". Keep only stable selection
fields.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import CalendarListProjection


def project_calendar_list_entry(raw: dict[str, Any]) -> CalendarListProjection:
    payload: dict[str, Any] = {
        "id": raw.get("id") or "",
        "summary": raw.get("summary") or "(no name)",
        "primary": bool(raw.get("primary")),
        "accessRole": raw.get("accessRole") or "",
        "timeZone": raw.get("timeZone") or "",
    }
    if raw.get("description"):
        payload["description"] = raw["description"]
    return CalendarListProjection.model_validate(payload)
