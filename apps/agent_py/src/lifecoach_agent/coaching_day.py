"""Shared coaching-day clock.

The user's reflective evening continues through the early hours. Before 05:00
local time, day-scoped coaching state belongs to the previous calendar date so
session history, usage, summaries, and calendar context agree with DailyFlow.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

COACHING_DAY_START_HOUR = 5


def coaching_date_and_hour(at: datetime, timezone: str | None) -> tuple[str, int]:
    """Return the coaching ``YYYY-MM-DD`` and the actual local hour."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    local = at.astimezone(ZoneInfo(timezone or "UTC"))
    coaching_date = local.date()
    if local.hour < COACHING_DAY_START_HOUR:
        coaching_date -= timedelta(days=1)
    return coaching_date.isoformat(), local.hour


def coaching_day_key(at: datetime, timezone: str | None) -> str:
    """Return the coaching-day date key for ``at`` in ``timezone``."""
    return coaching_date_and_hour(at, timezone)[0]
