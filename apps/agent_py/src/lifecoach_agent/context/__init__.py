"""HTTP context fetchers — read-only, in-memory cached, dependency-injected.

Mirrors `apps/agent/src/context/`. All four clients follow the same shape:
- `__init__` takes an optional `fetcher` callable (httpx-based by default)
- `get(...)` returns the normalised value or `None`/`[]` on any failure
- Results are cached in-memory keyed by rounded coords (or year+country)

The data shapes (`Coord`, `Weather`, `NearbyPlace`, `AirQuality`, `Holiday`)
live in `lifecoach_agent.prompt.build_instruction` for now; Phase 4 may
move them next to the fetchers.
"""

from __future__ import annotations

from lifecoach_agent.context.air_quality import (
    AirQualityClient,
    round_for_cache_aq,
)
from lifecoach_agent.context.air_quality import (
    HttpFetcher as AirQualityFetcher,
)
from lifecoach_agent.context.holidays import (
    HolidaysClient,
    tz_to_country,
)
from lifecoach_agent.context.holidays import (
    HttpFetcher as HolidaysFetcher,
)
from lifecoach_agent.context.places import (
    HttpFetcher as PlacesFetcher,
)
from lifecoach_agent.context.places import (
    PlacesClient,
)
from lifecoach_agent.context.weather import (
    HttpFetcher as WeatherFetcher,
)
from lifecoach_agent.context.weather import (
    WeatherClient,
    round_for_cache,
)

__all__ = [
    "AirQualityClient",
    "AirQualityFetcher",
    "HolidaysClient",
    "HolidaysFetcher",
    "PlacesClient",
    "PlacesFetcher",
    "WeatherClient",
    "WeatherFetcher",
    "round_for_cache",
    "round_for_cache_aq",
    "tz_to_country",
]
