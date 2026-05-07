"""Public-holidays client backed by date.nager.at — free, no auth.

Holidays are stable across a year, so we cache per (year, country) for
the lifetime of the process.

Mirrors `apps/agent/src/context/holidays.ts`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import httpx

from lifecoach_agent.prompt.build_instruction import Holiday

HttpFetcher = Callable[[str], Awaitable[httpx.Response]]


async def _default_fetcher(url: str) -> httpx.Response:
    async with httpx.AsyncClient() as client:
        return await client.get(url)


class HolidaysClient:
    def __init__(
        self,
        fetcher: HttpFetcher | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._fetcher: HttpFetcher = fetcher if fetcher is not None else _default_fetcher
        self._now: Callable[[], datetime] = now if now is not None else lambda: datetime.now(UTC)
        # Holidays for a (year, country) don't change mid-process. Cache
        # the in-flight task so concurrent callers de-duplicate.
        self._cache: dict[str, asyncio.Task[list[Holiday]]] = {}

    async def _fetch_year(self, year: int, country_code: str) -> list[Holiday]:
        url = f"https://date.nager.at/api/v3/PublicHolidays/{year}/{country_code}"
        try:
            res = await self._fetcher(url)
            if res.status_code != 200:
                return []
            body: list[dict[str, Any]] = res.json()
            return [
                Holiday(
                    date=h["date"],
                    localName=h["localName"],
                    countryCode=h["countryCode"],
                )
                for h in body
            ]
        except Exception:
            return []

    def _get_year(self, year: int, country_code: str) -> asyncio.Task[list[Holiday]]:
        key = f"{year}-{country_code}"
        existing = self._cache.get(key)
        if existing is not None:
            return existing
        task = asyncio.ensure_future(self._fetch_year(year, country_code))
        self._cache[key] = task
        return task

    async def next7Days(self, country_code: str) -> list[Holiday]:
        today = self._now()
        today_str = _iso_date(today)
        end = today + timedelta(days=7)
        end_str = _iso_date(end)

        year_start = _utc_year(today)
        year_end = _utc_year(end)
        years = [year_start] if year_start == year_end else [year_start, year_end]
        lists = await asyncio.gather(*(self._get_year(y, country_code) for y in years))
        all_holidays: list[Holiday] = [h for sub in lists for h in sub]
        return [h for h in all_holidays if today_str <= h.date <= end_str]


def _iso_date(d: datetime) -> str:
    if d.tzinfo is None:
        return d.date().isoformat()
    return d.astimezone(UTC).date().isoformat()


def _utc_year(d: datetime) -> int:
    if d.tzinfo is None:
        return d.year
    return d.astimezone(UTC).year


# --- timezone → country lookup -------------------------------------------

_TZ_TO_COUNTRY: Final[dict[str, str]] = {
    # United Kingdom + Ireland
    "Europe/London": "GB",
    "Europe/Belfast": "GB",
    "Europe/Dublin": "IE",
    # Western + Central Europe
    "Europe/Paris": "FR",
    "Europe/Madrid": "ES",
    "Europe/Lisbon": "PT",
    "Europe/Berlin": "DE",
    "Europe/Brussels": "BE",
    "Europe/Amsterdam": "NL",
    "Europe/Luxembourg": "LU",
    "Europe/Vienna": "AT",
    "Europe/Zurich": "CH",
    "Europe/Rome": "IT",
    "Europe/Athens": "GR",
    "Europe/Stockholm": "SE",
    "Europe/Oslo": "NO",
    "Europe/Copenhagen": "DK",
    "Europe/Helsinki": "FI",
    "Europe/Warsaw": "PL",
    "Europe/Prague": "CZ",
    "Europe/Budapest": "HU",
    "Europe/Bucharest": "RO",
    "Europe/Sofia": "BG",
    # Americas
    "America/New_York": "US",
    "America/Chicago": "US",
    "America/Denver": "US",
    "America/Los_Angeles": "US",
    "America/Phoenix": "US",
    "America/Anchorage": "US",
    "America/Honolulu": "US",
    "America/Toronto": "CA",
    "America/Vancouver": "CA",
    "America/Edmonton": "CA",
    "America/Halifax": "CA",
    "America/Mexico_City": "MX",
    "America/Sao_Paulo": "BR",
    "America/Buenos_Aires": "AR",
    "America/Santiago": "CL",
    # Oceania
    "Australia/Sydney": "AU",
    "Australia/Melbourne": "AU",
    "Australia/Brisbane": "AU",
    "Australia/Perth": "AU",
    "Australia/Adelaide": "AU",
    "Australia/Hobart": "AU",
    "Pacific/Auckland": "NZ",
    # Asia
    "Asia/Tokyo": "JP",
    "Asia/Seoul": "KR",
    "Asia/Shanghai": "CN",
    "Asia/Hong_Kong": "HK",
    "Asia/Taipei": "TW",
    "Asia/Singapore": "SG",
    "Asia/Kuala_Lumpur": "MY",
    "Asia/Bangkok": "TH",
    "Asia/Jakarta": "ID",
    "Asia/Manila": "PH",
    "Asia/Kolkata": "IN",
    "Asia/Dubai": "AE",
    "Asia/Tel_Aviv": "IL",
    "Asia/Jerusalem": "IL",
    # Africa
    "Africa/Cairo": "EG",
    "Africa/Johannesburg": "ZA",
    "Africa/Lagos": "NG",
    "Africa/Nairobi": "KE",
}


def tz_to_country(tz: str | None) -> str | None:
    if not tz:
        return None
    return _TZ_TO_COUNTRY.get(tz)
