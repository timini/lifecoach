"""Smoke tests for `CalendarDensityClient`. Phase 7 will swap in a real
google-api-python-client backed fetcher; until then we test the
bucketing + cache logic with an in-process stub."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from lifecoach_agent.context.calendar_density import (
    CalendarDensityClient,
    ScopeRequiredError,
)


class _FakeStore:
    def __init__(
        self, token: str | None = "tok", raises: type[BaseException] | None = None
    ) -> None:
        self.token = token
        self.raises = raises

    async def get_valid_access_token(self, uid: str) -> str:
        if self.raises is not None:
            raise self.raises("test")
        assert self.token is not None
        return self.token


def _evt(*, summary: str, start: str, end: str, all_day: bool = False) -> dict[str, Any]:
    if all_day:
        return {"summary": summary, "start": {"date": start}, "end": {"date": end}}
    return {"summary": summary, "start": {"dateTime": start}, "end": {"dateTime": end}}


@pytest.mark.asyncio
async def test_buckets_today_and_tomorrow_events() -> None:
    # 2026-05-06 09:00 BST (UTC+1) → "today" is 2026-05-06 in Europe/London
    now = datetime(2026, 5, 6, 8, 0, tzinfo=ZoneInfo("UTC"))
    items = [
        _evt(summary="Standup", start="2026-05-06T09:00:00+01:00", end="2026-05-06T09:30:00+01:00"),
        _evt(summary="Lunch", start="2026-05-06T12:00:00+01:00", end="2026-05-06T13:00:00+01:00"),
        _evt(
            summary="Deep work", start="2026-05-07T09:00:00+01:00", end="2026-05-07T11:00:00+01:00"
        ),
    ]

    async def fetch(_token: str, _cal: str, _tmin: str, _tmax: str) -> list[dict[str, Any]]:
        return items

    client = CalendarDensityClient(store=_FakeStore(), events_fetcher=fetch)
    summary = await client.get(uid="u1", timezone="Europe/London", now=now)
    assert summary is not None
    assert summary.today.count == 2
    assert summary.tomorrow.count == 1
    assert summary.today.events[0].summary == "Standup"


@pytest.mark.asyncio
async def test_returns_none_when_token_lapsed() -> None:
    async def fetch(*_a: Any, **_kw: Any) -> list[dict[str, Any]]:
        raise AssertionError("should not be called")

    client = CalendarDensityClient(
        store=_FakeStore(raises=ScopeRequiredError),
        events_fetcher=fetch,
    )
    out = await client.get(
        uid="u1",
        timezone="Europe/London",
        now=datetime(2026, 5, 6, 8, 0, tzinfo=ZoneInfo("UTC")),
    )
    assert out is None


@pytest.mark.asyncio
async def test_returns_none_when_fetch_fails() -> None:
    async def fetch(*_a: Any, **_kw: Any) -> list[dict[str, Any]] | None:
        return None

    client = CalendarDensityClient(store=_FakeStore(), events_fetcher=fetch)
    out = await client.get(
        uid="u1",
        timezone="Europe/London",
        now=datetime(2026, 5, 6, 8, 0, tzinfo=ZoneInfo("UTC")),
    )
    assert out is None


@pytest.mark.asyncio
async def test_cache_avoids_repeat_fetches() -> None:
    calls = 0

    async def fetch(*_a: Any, **_kw: Any) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        return []

    client = CalendarDensityClient(store=_FakeStore(), events_fetcher=fetch)
    now = datetime(2026, 5, 6, 8, 0, tzinfo=ZoneInfo("UTC"))
    await client.get(uid="u1", timezone="Europe/London", now=now)
    await client.get(uid="u1", timezone="Europe/London", now=now)
    assert calls == 1
