"""Mirror of `apps/agent/src/context/places.test.ts`.

The OAuth token-provider parameter is replaced with a direct
`access_token` argument to `client.get()` — Phase 5 will wire it back
through ADC.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from lifecoach_agent.context.places import PlacesClient
from lifecoach_agent.prompt.build_instruction import Coord


def _sample() -> dict[str, Any]:
    return {
        "places": [
            {
                "displayName": {"text": "Edinburgh Gardens"},
                "formattedAddress": "Alfred Crescent, Fitzroy North VIC",
                "types": ["park", "point_of_interest"],
                "primaryType": "park",
            },
            {
                "displayName": {"text": "Dukes Coffee Roasters"},
                "formattedAddress": "247 Flinders Ln, Melbourne VIC",
                "types": ["cafe", "food", "point_of_interest"],
                "primaryType": "cafe",
            },
        ]
    }


class FakeFetcher:
    def __init__(self, body: Any = None, status: int = 200) -> None:
        self._body = body if body is not None else _sample()
        self._status = status
        self.calls: list[tuple[str, dict[str, str], bytes]] = []

    async def __call__(self, url: str, headers: dict[str, str], body: bytes) -> httpx.Response:
        self.calls.append((url, headers, body))
        return httpx.Response(
            self._status,
            json=self._body if self._status == 200 else None,
            text=None if self._status == 200 else "error",
        )


class RaisingFetcher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str], bytes]] = []

    async def __call__(self, url: str, headers: dict[str, str], body: bytes) -> httpx.Response:
        self.calls.append((url, headers, body))
        raise RuntimeError("boom")


class FakeClock:
    def __init__(self) -> None:
        self.t: float = 0.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


async def test_returns_normalised_places() -> None:
    fetcher = FakeFetcher()
    client = PlacesClient(fetcher=fetcher, now=FakeClock())
    places = await client.get(Coord(lat=-37.81, lng=144.96), access_token="tok")
    assert [(p.name, p.address, p.type) for p in places] == [
        ("Edinburgh Gardens", "Alfred Crescent, Fitzroy North VIC", "park"),
        ("Dukes Coffee Roasters", "247 Flinders Ln, Melbourne VIC", "cafe"),
    ]


async def test_caches_for_60_minutes_default() -> None:
    fetcher = FakeFetcher()
    clock = FakeClock()
    client = PlacesClient(fetcher=fetcher, now=clock)
    coord = Coord(lat=-37.81, lng=144.96)

    await client.get(coord, access_token="tok")
    await client.get(coord, access_token="tok")
    assert len(fetcher.calls) == 1

    clock.advance(59 * 60)
    await client.get(coord, access_token="tok")
    assert len(fetcher.calls) == 1

    clock.advance(2 * 60)
    await client.get(coord, access_token="tok")
    assert len(fetcher.calls) == 2


async def test_sends_authorization_bearer_and_fieldmask() -> None:
    fetcher = FakeFetcher()
    client = PlacesClient(fetcher=fetcher, now=FakeClock())
    await client.get(Coord(lat=0, lng=0), access_token="abc.def")
    _, headers, body = fetcher.calls[0]
    assert headers["authorization"] == "Bearer abc.def"
    assert "places.displayName" in headers["x-goog-fieldmask"]
    parsed = json.loads(body)
    assert parsed["maxResultCount"] == 5


async def test_returns_empty_on_non_200() -> None:
    fetcher = FakeFetcher(body="error", status=500)
    client = PlacesClient(fetcher=fetcher, now=FakeClock())
    places = await client.get(Coord(lat=0, lng=0), access_token="tok")
    assert places == []


async def test_returns_empty_when_no_token() -> None:
    fetcher = FakeFetcher()
    client = PlacesClient(fetcher=fetcher, now=FakeClock())
    places = await client.get(Coord(lat=0, lng=0), access_token=None)
    assert places == []
    assert fetcher.calls == []


async def test_returns_empty_when_fetcher_throws() -> None:
    fetcher = RaisingFetcher()
    client = PlacesClient(fetcher=fetcher, now=FakeClock())
    places = await client.get(Coord(lat=0, lng=0), access_token="tok")
    assert places == []
