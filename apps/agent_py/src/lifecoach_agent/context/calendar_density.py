"""Pre-fetched calendar density (today + tomorrow event counts) injected
into the system prompt every turn.

Mirrors `apps/agent/src/context/calendarDensity.ts` minus the
`gws` CLI subprocess. Phase 7 plugs a `google-api-python-client`-backed
fetcher into `EventsFetcher`; until then this module is callable but
fetcher implementations are stubs in tests.

Auth: defers to a `WorkspaceTokensProtocol` (Phase 5 implements it).
Caching: per `(uid, tz)`, 5 minutes, invalidated on day rollover.
Failure mode: any error → return None. Never blocks a turn.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from lifecoach_agent.prompt.build_instruction import (
    CalendarDay,
    CalendarDensitySummary,
    TodayEvent,
)

TODAY_EVENT_LIMIT = 10
TTL_S = 5 * 60.0


class WorkspaceTokensProtocol(Protocol):
    """The workspace-tokens store. Phase 5 implements this against the
    Firestore-backed token doc."""

    async def get_valid_access_token(self, uid: str) -> str: ...


class ScopeRequiredError(Exception):
    """Raised by `WorkspaceTokensProtocol.get_valid_access_token` when
    the user has lapsed and needs to reconnect."""


# Function fetching events for `uid` between `time_min` and `time_max`
# (RFC3339 strings). Returns a list of dict-shaped events as the Calendar
# API returns them; we only read `summary`, `start.dateTime|date`,
# `end.dateTime|date`. Phase 7 implements this with `google-api-python-client`.
EventsFetcher = Callable[[str, str, str, str], Awaitable[list[dict[str, Any]] | None]]


@dataclass
class _CacheEntry:
    at: float
    today_date: str
    value: CalendarDensitySummary | None


def _date_in_tz(d: datetime, tz: str) -> str:
    return d.astimezone(ZoneInfo(tz)).strftime("%Y-%m-%d")


def _time_in_tz(d: datetime, tz: str) -> str:
    return d.astimezone(ZoneInfo(tz)).strftime("%H:%M")


def _parse_iso(s: str) -> datetime:
    """Parse an RFC3339 string into a tz-aware datetime."""
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class CalendarDensityClient:
    def __init__(
        self,
        *,
        store: WorkspaceTokensProtocol,
        events_fetcher: EventsFetcher,
        ttl_s: float = TTL_S,
        now: Callable[[], float] | None = None,
    ) -> None:
        self._store = store
        self._fetch = events_fetcher
        self._ttl = ttl_s
        self._now = now or time.monotonic
        self._cache: dict[str, _CacheEntry] = {}

    async def get(self, *, uid: str, timezone: str, now: datetime) -> CalendarDensitySummary | None:
        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)
        today_date = _date_in_tz(now, timezone)
        key = f"{uid}:{timezone}"
        now_t = self._now()
        hit = self._cache.get(key)
        if hit and hit.today_date == today_date and now_t - hit.at < self._ttl:
            return hit.value

        try:
            access_token = await self._store.get_valid_access_token(uid)
        except ScopeRequiredError:
            return None
        except Exception:  # noqa: BLE001
            return None

        time_min = (now - timedelta(hours=24)).astimezone(UTC).isoformat().replace("+00:00", "Z")
        time_max = (now + timedelta(hours=48)).astimezone(UTC).isoformat().replace("+00:00", "Z")
        try:
            items = await self._fetch(access_token, "primary", time_min, time_max)
        except Exception:  # noqa: BLE001
            return None
        if items is None:
            return None

        tomorrow_date = _date_in_tz(now + timedelta(days=1), timezone)
        summary = _bucket(items, today_date, tomorrow_date, timezone, now)
        self._cache[key] = _CacheEntry(at=now_t, today_date=today_date, value=summary)
        return summary


def _bucket(
    items: list[dict[str, Any]],
    today_date: str,
    tomorrow_date: str,
    tz: str,
    now: datetime,
) -> CalendarDensitySummary:
    today_starts: list[datetime] = []
    today_ends: list[datetime] = []
    today_events: list[tuple[float, TodayEvent]] = []
    today_count = 0
    tomorrow_starts: list[datetime] = []
    tomorrow_ends: list[datetime] = []
    tomorrow_count = 0

    for item in items:
        start = item.get("start") or {}
        start_str = start.get("dateTime") or start.get("date")
        if not start_str:
            continue
        is_all_day = "dateTime" not in start
        event_day = start_str if is_all_day else _date_in_tz(_parse_iso(start_str), tz)
        end = item.get("end") or {}
        if event_day == today_date:
            today_count += 1
            start_dt = _parse_iso(start["dateTime"]) if "dateTime" in start else None
            end_dt = _parse_iso(end["dateTime"]) if "dateTime" in end else None
            if not is_all_day and start_dt:
                today_starts.append(start_dt)
            if not is_all_day and end_dt:
                today_ends.append(end_dt)
            today_events.append(
                (
                    start_dt.timestamp() if start_dt else 0.0,
                    TodayEvent(
                        summary=(item.get("summary") or "").strip() or "(no title)",
                        start=_time_in_tz(start_dt, tz) if start_dt else None,
                        end=_time_in_tz(end_dt, tz) if end_dt else None,
                        allDay=is_all_day,
                    ),
                )
            )
        elif event_day == tomorrow_date:
            tomorrow_count += 1
            if not is_all_day and "dateTime" in start:
                tomorrow_starts.append(_parse_iso(start["dateTime"]))
            if not is_all_day and "dateTime" in end:
                tomorrow_ends.append(_parse_iso(end["dateTime"]))

    first_today = min(today_starts) if today_starts else None
    last_today = max(today_ends) if today_ends else None
    upcoming_today = sorted([d for d in today_starts if d >= now], key=lambda d: d.timestamp())
    next_today = upcoming_today[0] if upcoming_today else None

    today_events_sorted = [e for _k, e in sorted(today_events, key=lambda kv: kv[0])][
        :TODAY_EVENT_LIMIT
    ]

    return CalendarDensitySummary(
        today=CalendarDay(
            count=today_count,
            firstStart=_time_in_tz(first_today, tz) if first_today else None,
            lastEnd=_time_in_tz(last_today, tz) if last_today else None,
            nextStart=_time_in_tz(next_today, tz) if next_today else None,
            events=today_events_sorted,
        ),
        tomorrow=CalendarDay(
            count=tomorrow_count,
            firstStart=_time_in_tz(min(tomorrow_starts), tz) if tomorrow_starts else None,
            lastEnd=_time_in_tz(max(tomorrow_ends), tz) if tomorrow_ends else None,
            nextStart=None,
            events=[],
        ),
    )
