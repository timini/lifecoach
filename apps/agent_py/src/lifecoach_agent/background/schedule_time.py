"""Cadence → next-run-time + input-window computation (ADR 0001, step 5a).

The dispatcher advances each schedule's ``nextRunAt`` after enqueuing a run.
Cadence is a daily local-time policy in the schedule's IANA timezone, so the
next occurrence must be computed in that zone (DST-aware) and converted back
to canonical UTC for storage/ordering.

``weekdays`` uses the contract's 0=Sunday … 6=Saturday convention (see
``ScheduleCadence``); Python's ``date.weekday()`` is 0=Monday … 6=Sunday, so
we convert with ``(py_weekday + 1) % 7``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from lifecoach_agent.contracts.background import ScheduleCadence
from lifecoach_agent.storage.background_time import canonical_iso

# lookbackWindow literal → duration.
_LOOKBACK_TO_DELTA = {
    "12h": timedelta(hours=12),
    "1d": timedelta(days=1),
    "3d": timedelta(days=3),
}


def _to_cadence_weekday(dt: datetime) -> int:
    """Map a datetime's weekday to the contract's 0=Sun … 6=Sat convention."""
    return (dt.weekday() + 1) % 7


def next_run_at(cadence: ScheduleCadence, timezone: str, *, after_iso: str) -> str:
    """The first occurrence of ``cadence`` strictly after ``after_iso``.

    ``after_iso`` is a UTC ``…Z`` timestamp (typically the just-dispatched
    ``scheduledFor``). Returns canonical millisecond-precision UTC.
    """
    tz = ZoneInfo(timezone)
    hh, mm = (int(p) for p in cadence.localTime.split(":"))
    allowed = set(cadence.weekdays) if cadence.weekdays is not None else None

    after_utc = datetime.fromisoformat(after_iso.replace("Z", "+00:00")).astimezone(UTC)
    after_local = after_utc.astimezone(tz)

    # First candidate: today (local) at the cadence time.
    candidate = after_local.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if candidate <= after_local:
        candidate += timedelta(days=1)

    # Advance to the next permitted weekday (bounded: at most 7 hops).
    for _ in range(7):
        if allowed is None or _to_cadence_weekday(candidate) in allowed:
            break
        candidate += timedelta(days=1)

    return canonical_iso(candidate.astimezone(UTC).isoformat())


def input_window(lookback_window: str, *, scheduled_for_iso: str) -> tuple[str, str]:
    """``(start, end)`` for the run's Gmail query. ``end`` is the scheduled
    time; ``start`` is ``end`` minus the lookback duration. Both canonical UTC.
    """
    delta = _LOOKBACK_TO_DELTA.get(lookback_window)
    if delta is None:
        raise ValueError(f"unknown lookbackWindow: {lookback_window}")
    end = datetime.fromisoformat(scheduled_for_iso.replace("Z", "+00:00")).astimezone(UTC)
    start = end - delta
    return canonical_iso(start.isoformat()), canonical_iso(end.isoformat())
