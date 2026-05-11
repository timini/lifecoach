"""Mirror of `apps/agent/src/context/weather.test.ts`."""

from __future__ import annotations

from typing import Any

import httpx

from lifecoach_agent.context.weather import WeatherClient, round_for_cache
from lifecoach_agent.prompt.build_instruction import Coord


def _sample_response() -> dict[str, Any]:
    times: list[str] = []
    for i in range(48):
        day = "2026-04-21" if i < 24 else "2026-04-22"
        hour = i % 24
        times.append(f"{day}T{hour:02d}:00")

    rain: list[int] = []
    for h in range(24):
        if h == 15:
            rain.append(60)
        elif h == 14:
            rain.append(30)
        elif h == 16:
            rain.append(40)
        else:
            rain.append(10)
    rain.extend([5] * 24)  # tomorrow noise

    return {
        "current": {
            "time": "2026-04-21T09:00",
            "temperature_2m": 18.5,
            "weather_code": 2,
            "wind_speed_10m": 12,
        },
        "current_units": {"temperature_2m": "°C"},
        "daily": {
            "time": ["2026-04-21", "2026-04-22"],
            "temperature_2m_max": [22, 20],
            "temperature_2m_min": [12, 11],
            "weather_code": [2, 3],
            "sunrise": ["2026-04-21T06:32", "2026-04-22T06:34"],
            "sunset": ["2026-04-21T18:14", "2026-04-22T18:12"],
            "uv_index_max": [7.2, 6.8],
            "precipitation_probability_max": [40, 10],
            "daylight_duration": [42120, 41880],
        },
        "hourly": {
            "time": times,
            "precipitation_probability": rain,
            "uv_index": [3] * 48,
            "cloud_cover": [50] * 48,
        },
    }


class FakeFetcher:
    """Mimics vitest's vi.fn — records calls and returns a canned response."""

    def __init__(self, body: Any = None, status: int = 200) -> None:
        self._body = body if body is not None else _sample_response()
        self._status = status
        self.calls: list[str] = []

    async def __call__(self, url: str) -> httpx.Response:
        self.calls.append(url)
        return httpx.Response(
            self._status,
            json=self._body if self._status == 200 else None,
            text=None if self._status == 200 else "nope",
        )


class FakeClock:
    def __init__(self) -> None:
        self.t: float = 0.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def test_round_for_cache_rounds_to_2_decimals() -> None:
    assert round_for_cache(Coord(lat=-37.812345, lng=144.962999)) == Coord(lat=-37.81, lng=144.96)


async def test_returns_normalised_weather() -> None:
    fetcher = FakeFetcher()
    client = WeatherClient(fetcher=fetcher, now=FakeClock())
    w = await client.get(Coord(lat=-37.81, lng=144.96))
    assert w is not None
    assert w.current.temperatureC == 18.5
    assert [(d.date, d.maxC, d.minC) for d in w.forecast] == [
        ("2026-04-21", 22, 12),
        ("2026-04-22", 20, 11),
    ]
    assert len(fetcher.calls) == 1
    url = fetcher.calls[0]
    assert "latitude=-37.81" in url
    assert "longitude=144.96" in url


async def test_caches_for_30_minutes_default() -> None:
    fetcher = FakeFetcher()
    clock = FakeClock()
    client = WeatherClient(fetcher=fetcher, now=clock)

    await client.get(Coord(lat=-37.81, lng=144.96))
    await client.get(Coord(lat=-37.81, lng=144.96))
    assert len(fetcher.calls) == 1

    # 29 minutes later — still cached
    clock.advance(29 * 60)
    await client.get(Coord(lat=-37.81, lng=144.96))
    assert len(fetcher.calls) == 1

    # 31 minutes total — expired
    clock.advance(2 * 60 + 1)
    await client.get(Coord(lat=-37.81, lng=144.96))
    assert len(fetcher.calls) == 2


async def test_shares_cache_across_nearby_coords_after_rounding() -> None:
    fetcher = FakeFetcher()
    client = WeatherClient(fetcher=fetcher, now=FakeClock())
    await client.get(Coord(lat=-37.812, lng=144.962))
    await client.get(Coord(lat=-37.814, lng=144.963))  # both round to -37.81,144.96
    assert len(fetcher.calls) == 1


async def test_returns_none_on_non_200() -> None:
    fetcher = FakeFetcher(body="nope", status=500)
    client = WeatherClient(fetcher=fetcher, now=FakeClock())
    w = await client.get(Coord(lat=0, lng=0))
    assert w is None


async def test_today_block_with_sunrise_sunset_daylight_uv_rain_peak() -> None:
    fetcher = FakeFetcher()
    client = WeatherClient(fetcher=fetcher, now=FakeClock())
    w = await client.get(Coord(lat=-37.81, lng=144.96))
    assert w is not None
    assert w.today.sunrise == "2026-04-21T06:32"
    assert w.today.sunset == "2026-04-21T18:14"
    assert w.today.daylightHours == 11.7  # 42120 / 3600
    assert w.today.uvIndexMax == 7.2
    assert w.today.rainChancePeak is not None
    assert w.today.rainChancePeak.hour == "2026-04-21T15:00"
    assert w.today.rainChancePeak.probability == 60


async def test_rain_peak_null_when_no_meaningful_rain() -> None:
    body = _sample_response()
    body["hourly"]["precipitation_probability"] = [5] * 48
    fetcher = FakeFetcher(body=body)
    client = WeatherClient(fetcher=fetcher, now=FakeClock())
    w = await client.get(Coord(lat=-37.81, lng=144.96))
    assert w is not None
    assert w.today.rainChancePeak is None


async def test_url_includes_extended_fields() -> None:
    fetcher = FakeFetcher()
    client = WeatherClient(fetcher=fetcher, now=FakeClock())
    await client.get(Coord(lat=-37.81, lng=144.96))
    url = fetcher.calls[0]
    assert "sunrise" in url
    assert "sunset" in url
    assert "uv_index_max" in url
    assert "precipitation_probability_max" in url
    assert "daylight_duration" in url
    assert "hourly=" in url and "precipitation_probability" in url
