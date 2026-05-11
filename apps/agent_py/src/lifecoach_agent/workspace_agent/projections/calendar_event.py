"""Project a raw `calendar.events.list` / `events.get` response into the
shape the LLM consumes. Drops fields the coach doesn't need (creator,
organiser, sequence, etag, etc.) and shrinks attendees to email strings.

`start` / `end` keep both `dateTime` and `date` keys because the API
returns whichever of the two it uses (timed vs all-day events).
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import EventProjection, EventTime


def project_calendar_event(raw: dict[str, Any], calendar_id: str | None = None) -> EventProjection:
    attendees = [
        a.get("email")
        for a in (raw.get("attendees") or [])
        if isinstance(a, dict) and isinstance(a.get("email"), str) and a.get("email")
    ]
    payload: dict[str, Any] = {
        "id": raw.get("id") or "",
        "summary": raw.get("summary") or "(no title)",
        "start": _pick_time(raw.get("start")),
        "end": _pick_time(raw.get("end")),
    }
    if calendar_id is not None:
        payload["calendarId"] = calendar_id
    if raw.get("location"):
        payload["location"] = raw["location"]
    if raw.get("htmlLink"):
        payload["link"] = raw["htmlLink"]
    if raw.get("status"):
        payload["status"] = raw["status"]
    if raw.get("description"):
        payload["description"] = raw["description"]
    if attendees:
        payload["attendees"] = attendees
    return EventProjection.model_validate(payload)


def _pick_time(time: dict[str, Any] | None) -> EventTime:
    if not time:
        return EventTime()
    return EventTime(
        dateTime=time.get("dateTime"),
        date=time.get("date"),
        timeZone=time.get("timeZone"),
    )
