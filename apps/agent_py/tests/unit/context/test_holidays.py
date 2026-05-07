"""Mirror of `apps/agent/src/context/holidays.test.ts`."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from lifecoach_agent.context.holidays import HolidaysClient, tz_to_country

SAMPLE_GB_2026 = [
    {
        "date": "2026-01-01",
        "localName": "New Year's Day",
        "name": "New Year's Day",
        "countryCode": "GB",
    },
    {"date": "2026-04-03", "localName": "Good Friday", "name": "Good Friday", "countryCode": "GB"},
    {
        "date": "2026-05-04",
        "localName": "Early May Bank Holiday",
        "name": "Early May Bank Holiday",
        "countryCode": "GB",
    },
    {
        "date": "2026-12-25",
        "localName": "Christmas Day",
        "name": "Christmas Day",
        "countryCode": "GB",
    },
]


class FakeFetcher:
    def __init__(self, body: Any = None, status: int = 200) -> None:
        self._body = body if body is not None else SAMPLE_GB_2026
        self._status = status
        self.calls: list[str] = []

    async def __call__(self, url: str) -> httpx.Response:
        self.calls.append(url)
        return httpx.Response(
            self._status,
            json=self._body if self._status == 200 else None,
            text=None if self._status == 200 else "nope",
        )


class SequenceFetcher:
    """Returns a different canned response per call (in order)."""

    def __init__(self, responses: list[tuple[Any, int]]) -> None:
        self._responses = responses
        self.calls: list[str] = []

    async def __call__(self, url: str) -> httpx.Response:
        body, status = self._responses[len(self.calls)]
        self.calls.append(url)
        return httpx.Response(
            status,
            json=body if status == 200 else None,
            text=None if status == 200 else "nope",
        )


class RaisingFetcher:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def __call__(self, url: str) -> httpx.Response:
        self.calls.append(url)
        raise RuntimeError("boom")


def _fixed_now(iso: str) -> Any:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return lambda: dt


def test_tz_to_country_maps_common_timezones() -> None:
    assert tz_to_country("Europe/London") == "GB"
    assert tz_to_country("Australia/Melbourne") == "AU"
    assert tz_to_country("America/New_York") == "US"
    assert tz_to_country("Asia/Tokyo") == "JP"


def test_tz_to_country_returns_none_for_unmapped_or_null() -> None:
    assert tz_to_country("Antarctica/Casey") is None
    assert tz_to_country(None) is None
    assert tz_to_country("") is None


async def test_no_holidays_in_next_7_days_when_window_is_quiet() -> None:
    # mid-June 2026 — no holidays in the next 7 days.
    client = HolidaysClient(fetcher=FakeFetcher(), now=_fixed_now("2026-06-15T09:00:00Z"))
    assert await client.next7Days("GB") == []


async def test_returns_holidays_within_next_7_days_inclusive() -> None:
    # 4 days before May 4 BH.
    client = HolidaysClient(fetcher=FakeFetcher(), now=_fixed_now("2026-04-30T09:00:00Z"))
    result = await client.next7Days("GB")
    assert len(result) == 1
    h = result[0]
    assert h.date == "2026-05-04"
    assert h.localName == "Early May Bank Holiday"
    assert h.countryCode == "GB"


async def test_hits_correct_endpoint_for_year_and_country() -> None:
    fetcher = FakeFetcher()
    client = HolidaysClient(fetcher=fetcher, now=_fixed_now("2026-06-15T09:00:00Z"))
    await client.next7Days("GB")
    assert fetcher.calls[0] == "https://date.nager.at/api/v3/PublicHolidays/2026/GB"


async def test_caches_per_year_country_pair() -> None:
    fetcher = FakeFetcher()
    client = HolidaysClient(fetcher=fetcher, now=_fixed_now("2026-06-15T09:00:00Z"))
    await client.next7Days("GB")
    await client.next7Days("GB")
    assert len(fetcher.calls) == 1


async def test_separate_cache_entries_per_country() -> None:
    fetcher = FakeFetcher()
    client = HolidaysClient(fetcher=fetcher, now=_fixed_now("2026-06-15T09:00:00Z"))
    await client.next7Days("GB")
    await client.next7Days("AU")
    assert len(fetcher.calls) == 2


async def test_crosses_year_boundary_when_window_spans_dec_jan() -> None:
    fetcher = SequenceFetcher(
        [
            (SAMPLE_GB_2026, 200),
            (
                [
                    {
                        "date": "2027-01-01",
                        "localName": "New Year's Day",
                        "name": "New Year's Day",
                        "countryCode": "GB",
                    }
                ],
                200,
            ),
        ]
    )
    client = HolidaysClient(fetcher=fetcher, now=_fixed_now("2026-12-29T09:00:00Z"))
    result = await client.next7Days("GB")
    assert [h.date for h in result] == ["2027-01-01"]
    assert len(fetcher.calls) == 2  # both years fetched


async def test_returns_empty_list_on_non_200() -> None:
    client = HolidaysClient(
        fetcher=FakeFetcher(body="nope", status=500),
        now=_fixed_now("2026-06-15T09:00:00Z"),
    )
    assert await client.next7Days("GB") == []


async def test_returns_empty_list_on_throw() -> None:
    client = HolidaysClient(fetcher=RaisingFetcher(), now=_fixed_now("2026-06-15T09:00:00Z"))
    assert await client.next7Days("GB") == []
