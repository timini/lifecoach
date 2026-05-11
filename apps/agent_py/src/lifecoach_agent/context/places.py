"""Google Places API (New) client.

Returns up to 5 interesting places near a given lat/lng. Cached 60 minutes
keyed by 2-decimal rounded coordinates (same convention as weather).

The OAuth2 access-token provider (ADC) is deferred to Phase 5 — for now
`get(coord, access_token)` takes the token directly. Pass `None` to skip
the call (cached as empty list).

Mirrors `apps/agent/src/context/places.ts`.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from lifecoach_agent.context.weather import round_for_cache
from lifecoach_agent.prompt.build_instruction import Coord, NearbyPlace

HttpFetcher = Callable[[str, dict[str, str], bytes], Awaitable[httpx.Response]]

_TTL_S: float = 60 * 60.0
_ENDPOINT: str = "https://places.googleapis.com/v1/places:searchNearby"
_RADIUS_M: int = 2_000
_INCLUDED_TYPES: list[str] = ["park", "cafe", "gym", "library", "bakery"]
_FIELD_MASK: str = "places.displayName,places.formattedAddress,places.types,places.primaryType"


def _cache_key(c: Coord) -> str:
    r = round_for_cache(c)
    return f"{r.lat},{r.lng}"


@dataclass
class _CacheEntry:
    at: float
    value: list[NearbyPlace]


async def _default_fetcher(url: str, headers: dict[str, str], body: bytes) -> httpx.Response:
    async with httpx.AsyncClient() as client:
        return await client.post(url, headers=headers, content=body)


class PlacesClient:
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

    async def get(self, coord: Coord, access_token: str | None) -> list[NearbyPlace]:
        key = _cache_key(coord)
        hit = self._cache.get(key)
        if hit is not None and self._now() - hit.at < self._ttl_s:
            return hit.value

        if access_token is None:
            self._cache[key] = _CacheEntry(at=self._now(), value=[])
            return []

        body: dict[str, Any] = {
            "includedTypes": _INCLUDED_TYPES,
            "maxResultCount": 5,
            "rankPreference": "POPULARITY",
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": coord.lat, "longitude": coord.lng},
                    "radius": _RADIUS_M,
                }
            },
        }
        headers = {
            "authorization": f"Bearer {access_token}",
            "content-type": "application/json",
            "x-goog-fieldmask": _FIELD_MASK,
        }

        try:
            res = await self._fetcher(_ENDPOINT, headers, json.dumps(body).encode("utf-8"))
            if res.status_code != 200:
                self._cache[key] = _CacheEntry(at=self._now(), value=[])
                return []
            parsed: dict[str, Any] = res.json()
            raw_places: list[dict[str, Any]] = parsed.get("places") or []
            places: list[NearbyPlace] = []
            for p in raw_places:
                display_name = p.get("displayName") or {}
                name = display_name.get("text") or ""
                if not name:
                    continue
                primary = p.get("primaryType")
                types = p.get("types") or []
                place_type = primary or (types[0] if types else "")
                places.append(
                    NearbyPlace(
                        name=name,
                        address=p.get("formattedAddress") or "",
                        type=place_type,
                    )
                )
            self._cache[key] = _CacheEntry(at=self._now(), value=places)
            return places
        except Exception:
            self._cache[key] = _CacheEntry(at=self._now(), value=[])
            return []
