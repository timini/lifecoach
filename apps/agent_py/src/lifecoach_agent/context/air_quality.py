"""Open-Meteo air-quality client.

Returns the European AQI plus PM2.5, PM10, ozone and the three main
pollens. Free, no API key.

Cache key rounds to 1 decimal place (~10 km) — air quality varies less
granularly than weather, and we don't want to hammer the upstream when
a city full of users all have slightly different lat/lng.

Mirrors `apps/agent/src/context/airQuality.ts`.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from lifecoach_agent.prompt.build_instruction import AirQuality, Coord, PollenCounts

HttpFetcher = Callable[[str], Awaitable[httpx.Response]]

_TTL_S: float = 60 * 60.0


def round_for_cache_aq(c: Coord) -> Coord:
    """Round to 1 decimal place (~10km) — coarser than weather rounding."""
    return Coord(lat=_round_to(c.lat, 1), lng=_round_to(c.lng, 1))


def _round_to(n: float, places: int) -> float:
    factor = 10**places
    return float(round(n * factor) / factor)


def _cache_key(c: Coord) -> str:
    r = round_for_cache_aq(c)
    return f"{r.lat},{r.lng}"


@dataclass
class _CacheEntry:
    at: float
    value: AirQuality | None


async def _default_fetcher(url: str) -> httpx.Response:
    async with httpx.AsyncClient() as client:
        return await client.get(url)


class AirQualityClient:
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

    async def get(self, coord: Coord) -> AirQuality | None:
        key = _cache_key(coord)
        hit = self._cache.get(key)
        if hit is not None and self._now() - hit.at < self._ttl_s:
            return hit.value

        rounded = round_for_cache_aq(coord)
        fields = "european_aqi,pm2_5,pm10,ozone,alder_pollen,grass_pollen,ragweed_pollen"
        url = (
            "https://air-quality-api.open-meteo.com/v1/air-quality"
            f"?latitude={rounded.lat}&longitude={rounded.lng}"
            f"&current={fields}&timezone=auto"
        )

        try:
            res = await self._fetcher(url)
            if res.status_code != 200:
                self._cache[key] = _CacheEntry(at=self._now(), value=None)
                return None
            body: dict[str, Any] = res.json()
            current: dict[str, Any] = body.get("current", {})
            aq = AirQuality(
                aqi=current.get("european_aqi") or 0,
                pm2_5=current.get("pm2_5") or 0,
                pm10=current.get("pm10") or 0,
                ozone=current.get("ozone") or 0,
                pollen=PollenCounts(
                    alder=current.get("alder_pollen") or 0,
                    grass=current.get("grass_pollen") or 0,
                    ragweed=current.get("ragweed_pollen") or 0,
                ),
            )
            self._cache[key] = _CacheEntry(at=self._now(), value=aq)
            return aq
        except Exception:
            self._cache[key] = _CacheEntry(at=self._now(), value=None)
            return None
