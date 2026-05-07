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
from lifecoach_agent.context.calendar_density import (
    TODAY_EVENT_LIMIT,
    CalendarDensityClient,
    EventsFetcher,
    ScopeRequiredError,
    WorkspaceTokensProtocol,
)
from lifecoach_agent.context.holidays import (
    HolidaysClient,
    tz_to_country,
)
from lifecoach_agent.context.holidays import (
    HttpFetcher as HolidaysFetcher,
)
from lifecoach_agent.context.memory import (
    Memory,
    MemoryClient,
    VertexMemoryClient,
    create_vertex_memory_client,
    noop_memory_client,
)
from lifecoach_agent.context.places import (
    HttpFetcher as PlacesFetcher,
)
from lifecoach_agent.context.places import (
    PlacesClient,
)
from lifecoach_agent.context.session_summarizer import (
    create_gemini_flash_lite_summarizer,
)
from lifecoach_agent.context.session_summary import (
    DaySummary,
    SessionSummaryClient,
    SessionSummaryStore,
    Summarizer,
    transcript_from_events,
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
    "CalendarDensityClient",
    "DaySummary",
    "EventsFetcher",
    "HolidaysClient",
    "HolidaysFetcher",
    "Memory",
    "MemoryClient",
    "PlacesClient",
    "PlacesFetcher",
    "ScopeRequiredError",
    "SessionSummaryClient",
    "SessionSummaryStore",
    "Summarizer",
    "TODAY_EVENT_LIMIT",
    "VertexMemoryClient",
    "WeatherClient",
    "WeatherFetcher",
    "WorkspaceTokensProtocol",
    "create_gemini_flash_lite_summarizer",
    "create_vertex_memory_client",
    "noop_memory_client",
    "round_for_cache",
    "round_for_cache_aq",
    "transcript_from_events",
    "tz_to_country",
]
