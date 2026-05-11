"""Prompt assembly for the root agent.

`build_instruction(ctx)` is called once per /chat turn from the server,
producing the full system prompt the agent runs against.
"""

from lifecoach_agent.prompt.build_instruction import (
    AirQuality,
    CalendarDay,
    CalendarDensitySummary,
    Coord,
    Holiday,
    InstructionContext,
    LocationCtx,
    Memory,
    NearbyPlace,
    PollenCounts,
    TodayEvent,
    Weather,
    WeatherCurrent,
    WeatherForecastDay,
    WeatherToday,
    build_instruction,
)

__all__ = [
    "AirQuality",
    "CalendarDay",
    "CalendarDensitySummary",
    "Coord",
    "Holiday",
    "InstructionContext",
    "LocationCtx",
    "Memory",
    "NearbyPlace",
    "PollenCounts",
    "TodayEvent",
    "Weather",
    "WeatherCurrent",
    "WeatherForecastDay",
    "WeatherToday",
    "build_instruction",
]
