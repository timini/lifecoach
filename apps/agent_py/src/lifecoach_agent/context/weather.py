"""Open-Meteo client for weather context.

Results are cached for 30 minutes keyed by lat/lng rounded to 2 decimal
places (~1km resolution) so nearby coordinates share a cache entry.

Mirrors `apps/agent/src/context/weather.ts`. The TS file is the
behavioural source of truth.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from lifecoach_agent.prompt.build_instruction import (
    Coord,
    RainPeak,
    Weather,
    WeatherCurrent,
    WeatherForecastDay,
    WeatherToday,
)

HttpFetcher = Callable[[str], Awaitable[httpx.Response]]

_TTL_S: float = 30 * 60.0
_RAIN_PEAK_MIN: int = 20


def round_for_cache(c: Coord) -> Coord:
    """Round to 2 decimal places (~1km) so nearby coords share a cache entry."""
    return Coord(lat=_round_to(c.lat, 2), lng=_round_to(c.lng, 2))


def _round_to(n: float, places: int) -> float:
    factor = 10**places
    return float(round(n * factor) / factor)


def _cache_key(c: Coord) -> str:
    r = round_for_cache(c)
    return f"{r.lat},{r.lng}"


@dataclass
class _CacheEntry:
    at: float
    value: Weather | None


async def _default_fetcher(url: str) -> httpx.Response:
    async with httpx.AsyncClient() as client:
        return await client.get(url)


class WeatherClient:
    def __init__(
        self,
        fetcher: HttpFetcher | None = None,
        now: Callable[[], float] | None = None,
        ttl_s: float | None = None,
    ) -> None:
        self._fetcher: HttpFetcher = fetcher if fetcher is not None else _default_fetcher
        self._now: Callable[[], float] = now if now is not None else time.monotonic
        self._ttl_s: float = ttl_s if ttl_s is not None else _TTL_S
        self._cache: dict[str, _CacheEntry] = {}

    async def get(self, coord: Coord) -> Weather | None:
        key = _cache_key(coord)
        hit = self._cache.get(key)
        if hit is not None and self._now() - hit.at < self._ttl_s:
            return hit.value

        rounded = round_for_cache(coord)
        daily_fields = (
            "temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,"
            "uv_index_max,precipitation_probability_max,daylight_duration"
        )
        hourly_fields = "precipitation_probability,uv_index,cloud_cover"
        url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={rounded.lat}&longitude={rounded.lng}"
            "&current=temperature_2m,weather_code,wind_speed_10m"
            f"&daily={daily_fields}"
            f"&hourly={hourly_fields}"
            "&forecast_days=7&timezone=auto"
        )

        try:
            res = await self._fetcher(url)
            if res.status_code != 200:
                self._cache[key] = _CacheEntry(at=self._now(), value=None)
                return None
            body: dict[str, Any] = res.json()
            weather = _parse(body)
            self._cache[key] = _CacheEntry(at=self._now(), value=weather)
            return weather
        except Exception:
            self._cache[key] = _CacheEntry(at=self._now(), value=None)
            return None


def _parse(body: dict[str, Any]) -> Weather:
    current = body["current"]
    daily = body["daily"]
    forecast = [
        WeatherForecastDay(
            date=date,
            maxC=_get_or(daily.get("temperature_2m_max"), i, float("nan")),
            minC=_get_or(daily.get("temperature_2m_min"), i, float("nan")),
            code=int(_get_or(daily.get("weather_code"), i, 0)),
        )
        for i, date in enumerate(daily.get("time", []))
    ]
    return Weather(
        current=WeatherCurrent(
            temperatureC=current["temperature_2m"],
            windKph=current["wind_speed_10m"],
            code=int(current["weather_code"]),
            time=current["time"],
        ),
        forecast=forecast,
        today=_build_today_block(body),
    )


def _build_today_block(body: dict[str, Any]) -> WeatherToday:
    daily = body["daily"]
    hourly = body["hourly"]
    today_date: str = (daily.get("time") or [""])[0]

    rain_probs = hourly.get("precipitation_probability") or []
    times = hourly.get("time") or []
    today_hours: list[tuple[str, float]] = []
    for i, t in enumerate(times):
        if not t or not t.startswith(today_date):
            continue
        rain = rain_probs[i] if i < len(rain_probs) and rain_probs[i] is not None else 0
        today_hours.append((t, rain))

    peak: tuple[str, float] | None = None
    for t, rain in today_hours:
        if peak is None or rain > peak[1]:
            peak = (t, rain)

    rain_chance_peak: RainPeak | None = None
    if peak is not None and peak[1] >= _RAIN_PEAK_MIN:
        rain_chance_peak = RainPeak(hour=peak[0], probability=int(peak[1]))

    return WeatherToday(
        sunrise=_get_or(daily.get("sunrise"), 0, ""),
        sunset=_get_or(daily.get("sunset"), 0, ""),
        daylightHours=_round_to(_get_or(daily.get("daylight_duration"), 0, 0) / 3600, 1),
        uvIndexMax=_get_or(daily.get("uv_index_max"), 0, 0),
        rainChancePeak=rain_chance_peak,
    )


def _get_or(seq: list[Any] | None, i: int, default: Any) -> Any:
    if seq is None or i >= len(seq) or seq[i] is None:
        return default
    return seq[i]
