"""Local-clock helpers shared by practice directives that gate on a
specific time-of-day window or stamp idempotency by local date.

Mirrors `apps/agent/src/practices/dayClock.ts`. The TS version uses
`Intl.DateTimeFormat` with locales chosen for predictable output
(en-CA gives YYYY-MM-DD, sv-SE gives 0–23 hours). In Python we use
zoneinfo + strftime which gives the same shape directly.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo


def local_date_and_hour(now: datetime, tz: str | None) -> tuple[str, int]:
    """Return `(YYYY-MM-DD, hour-0-23)` for `now` interpreted in `tz`.

    `tz=None` falls back to UTC. `now` is treated as a timezone-aware
    `datetime` — naive datetimes are interpreted as UTC for safety.
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=ZoneInfo("UTC"))
    target = ZoneInfo(tz) if tz else ZoneInfo("UTC")
    local = now.astimezone(target)
    return local.strftime("%Y-%m-%d"), local.hour
