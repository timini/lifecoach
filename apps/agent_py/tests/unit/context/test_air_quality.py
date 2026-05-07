"""Mirror of `apps/agent/src/context/airQuality.test.ts`."""

from __future__ import annotations

from typing import Any

import httpx

from lifecoach_agent.context.air_quality import AirQualityClient, round_for_cache_aq
from lifecoach_agent.prompt.build_instruction import Coord


def _sample() -> dict[str, Any]:
    return {
        "current": {
            "time": "2026-04-21T09:00",
            "european_aqi": 65,
            "pm2_5": 35,
            "pm10": 50,
            "ozone": 80,
            "alder_pollen": 0.2,
            "grass_pollen": 4.1,
            "ragweed_pollen": 0.5,
        }
    }


class FakeFetcher:
    def __init__(self, body: Any = None, status: int = 200) -> None:
        self._body = body if body is not None else _sample()
        self._status = status
        self.calls: list[str] = []

    async def __call__(self, url: str) -> httpx.Response:
        self.calls.append(url)
        return httpx.Response(
            self._status,
            json=self._body if self._status == 200 else None,
            text=None if self._status == 200 else "nope",
        )


class RaisingFetcher:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def __call__(self, url: str) -> httpx.Response:
        self.calls.append(url)
        raise RuntimeError("boom")


class FakeClock:
    def __init__(self) -> None:
        self.t: float = 0.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def test_round_for_cache_aq_rounds_to_1_decimal() -> None:
    assert round_for_cache_aq(Coord(lat=-37.812345, lng=144.962999)) == Coord(lat=-37.8, lng=145.0)


async def test_returns_normalised_air_quality() -> None:
    fetcher = FakeFetcher()
    client = AirQualityClient(fetcher=fetcher, now=FakeClock())
    aq = await client.get(Coord(lat=-37.81, lng=144.96))
    assert aq is not None
    assert aq.aqi == 65
    assert aq.pm2_5 == 35
    assert aq.pm10 == 50
    assert aq.ozone == 80
    assert aq.pollen.alder == 0.2
    assert aq.pollen.grass == 4.1
    assert aq.pollen.ragweed == 0.5


async def test_url_includes_air_quality_endpoint_and_fields() -> None:
    fetcher = FakeFetcher()
    client = AirQualityClient(fetcher=fetcher, now=FakeClock())
    await client.get(Coord(lat=-37.81, lng=144.96))
    url = fetcher.calls[0]
    assert "air-quality-api.open-meteo.com" in url
    assert "european_aqi" in url
    assert "pm2_5" in url
    assert "grass_pollen" in url


async def test_caches_for_60_minutes_default() -> None:
    fetcher = FakeFetcher()
    clock = FakeClock()
    client = AirQualityClient(fetcher=fetcher, now=clock)
    coord = Coord(lat=-37.81, lng=144.96)

    await client.get(coord)
    await client.get(coord)
    assert len(fetcher.calls) == 1

    clock.advance(59 * 60)
    await client.get(coord)
    assert len(fetcher.calls) == 1

    clock.advance(2 * 60)
    await client.get(coord)
    assert len(fetcher.calls) == 2


async def test_shares_cache_across_nearby_coords_1_decimal() -> None:
    fetcher = FakeFetcher()
    client = AirQualityClient(fetcher=fetcher, now=FakeClock())
    await client.get(Coord(lat=-37.82, lng=144.96))
    await client.get(Coord(lat=-37.84, lng=144.97))  # both round to -37.8, 145.0
    assert len(fetcher.calls) == 1


async def test_returns_none_on_non_200() -> None:
    fetcher = FakeFetcher(body="nope", status=500)
    client = AirQualityClient(fetcher=fetcher, now=FakeClock())
    aq = await client.get(Coord(lat=0, lng=0))
    assert aq is None


async def test_returns_none_on_throw_and_caches_null() -> None:
    fetcher = RaisingFetcher()
    client = AirQualityClient(fetcher=fetcher, now=FakeClock())
    assert await client.get(Coord(lat=0, lng=0)) is None
    # Re-call within TTL — same null cached, no second fetch.
    assert await client.get(Coord(lat=0, lng=0)) is None
    assert len(fetcher.calls) == 1
