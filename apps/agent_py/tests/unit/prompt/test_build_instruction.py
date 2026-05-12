"""Smoke tests for the system-prompt assembler. We're not snapshotting the
TS output byte-for-byte (line lengths and yaml output differ slightly
between yaml.dump and js-yaml); instead we check that the right blocks
appear or are omitted under the conditions that matter most.

Phase 11's parity check (real model output) is the cross-language
verification — these tests just guard the structural contract."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

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


def _base_ctx(**overrides) -> InstructionContext:  # type: ignore[no-untyped-def]
    base = InstructionContext(
        now=datetime(2026, 5, 6, 9, 0, tzinfo=ZoneInfo("UTC")),
        timezone="Europe/London",
        user_state="anonymous",
    )
    for k, v in overrides.items():
        setattr(base, k, v)
    return base


# --- always-present blocks ----------------------------------------------


def test_persona_header_always_present() -> None:
    out = build_instruction(_base_ctx())
    assert out.startswith("You are Lifecoach")


def test_style_rules_present() -> None:
    out = build_instruction(_base_ctx())
    assert "STYLE:" in out


def test_style_rules_encourage_light_formatting() -> None:
    out = build_instruction(_base_ctx())
    assert "Use light Markdown formatting" in out
    assert "short headings" in out
    assert "0–2 relevant emojis" in out
    assert "never decorative spam" in out
    assert "For simple emotional replies, skip heavy structure" in out


def test_style_rules_allow_scannable_bullets() -> None:
    out = build_instruction(_base_ctx())
    assert "scannable bullets" in out
    assert "Never use bullet lists unless" not in out


def test_user_state_block_present() -> None:
    out = build_instruction(_base_ctx())
    assert "USER_STATE: anonymous" in out
    assert "STATE_DIRECTIVE:" in out


def test_current_time_block_present() -> None:
    out = build_instruction(_base_ctx())
    assert "CURRENT_TIME" in out
    assert "now_local" in out
    assert "timezone: Europe/London" in out


def test_day_phase_block_present() -> None:
    out = build_instruction(_base_ctx())
    # 09:00 UTC + has_interacted_today=False → morning_greeting
    assert "DAY_PHASE: morning_greeting" in out


# --- conditional blocks --------------------------------------------------


def test_workspace_cheatsheet_only_when_workspace_connected() -> None:
    out_anon = build_instruction(_base_ctx(user_state="anonymous"))
    assert "WORKSPACE — six narrow tools" not in out_anon
    out_ws = build_instruction(_base_ctx(user_state="workspace_connected"))
    assert "WORKSPACE — six narrow tools" in out_ws
    assert "triage_inbox" in out_ws
    assert "find_workspace" in out_ws
    assert "archive_messages" in out_ws


def test_signup_nudge_only_when_nudge_mode_signup() -> None:
    out_none = build_instruction(_base_ctx())
    assert "SIGNUP_NUDGE:" not in out_none
    out_signup = build_instruction(_base_ctx(nudge_mode="signup"))
    assert "SIGNUP_NUDGE:" in out_signup


def test_pro_nudge_only_when_nudge_mode_pro() -> None:
    out_pro = build_instruction(_base_ctx(nudge_mode="pro"))
    assert "PRO_NUDGE:" in out_pro


def test_location_unknown_when_no_location() -> None:
    out = build_instruction(_base_ctx())
    assert "user_location: unknown" in out


def test_location_block_renders_city_country() -> None:
    location = LocationCtx(coord=Coord(lat=51.5, lng=-0.1), city="London", country="UK")
    out = build_instruction(_base_ctx(location=location))
    assert "city_country: London, UK" in out
    assert "coord: 51.5,-0.1" in out


def test_weather_unavailable_when_location_known_but_weather_none() -> None:
    location = LocationCtx(coord=Coord(lat=51.5, lng=-0.1), city="London", country="UK")
    out = build_instruction(_base_ctx(location=location, weather=None))
    assert "weather_unavailable" in out


def test_weather_block_renders_when_present() -> None:
    location = LocationCtx(coord=Coord(lat=51.5, lng=-0.1), city="London", country="UK")
    weather = Weather(
        current=WeatherCurrent(temperatureC=14.0, windKph=10.0, code=2, time="2026-05-06T09:00"),
        forecast=[WeatherForecastDay(date="2026-05-06", minC=8.0, maxC=18.0, code=2)],
        today=WeatherToday(
            sunrise="2026-05-06T05:30",
            sunset="2026-05-06T20:45",
            daylightHours=15.25,
            uvIndexMax=4.0,
            rainChancePeak=None,
        ),
    )
    out = build_instruction(_base_ctx(location=location, weather=weather))
    assert "WEATHER:" in out
    assert "current: 14.0°C" in out


def test_air_quality_silenced_when_clear() -> None:
    location = LocationCtx(coord=Coord(lat=51.5, lng=-0.1), city="London", country="UK")
    aq = AirQuality(
        aqi=20,
        pm2_5=5,
        pm10=10,
        ozone=30,
        pollen=PollenCounts(alder=0, grass=1, ragweed=0),
    )
    out = build_instruction(_base_ctx(location=location, air_quality=aq))
    assert "AIR_QUALITY:" not in out


def test_air_quality_emits_when_above_moderate() -> None:
    location = LocationCtx(coord=Coord(lat=51.5, lng=-0.1), city="London", country="UK")
    aq = AirQuality(
        aqi=85,
        pm2_5=25,
        pm10=40,
        ozone=80,
        pollen=PollenCounts(alder=0, grass=1, ragweed=0),
    )
    out = build_instruction(_base_ctx(location=location, air_quality=aq))
    assert "AIR_QUALITY:" in out
    assert "poor" in out


def test_holidays_block_only_when_present() -> None:
    out_no = build_instruction(_base_ctx())
    assert "HOLIDAYS" not in out_no
    out_yes = build_instruction(
        _base_ctx(
            holidays=[Holiday(date="2026-05-25", localName="Spring bank holiday", countryCode="GB")]
        )
    )
    assert "HOLIDAYS (next 7 days" in out_yes


def test_calendar_density_silenced_when_both_zero() -> None:
    cd = CalendarDensitySummary(
        today=CalendarDay(count=0, firstStart=None, lastEnd=None, nextStart=None, events=[]),
        tomorrow=CalendarDay(count=0, firstStart=None, lastEnd=None, nextStart=None, events=[]),
    )
    out = build_instruction(_base_ctx(calendar_density=cd))
    assert "CALENDAR" not in out


def test_calendar_density_emits_when_today_has_events() -> None:
    cd = CalendarDensitySummary(
        today=CalendarDay(
            count=2,
            firstStart="09:00",
            lastEnd="11:00",
            nextStart="10:00",
            events=[
                TodayEvent(summary="Standup", start="09:00", end="09:30", allDay=False),
                TodayEvent(summary="1:1 Alex", start="10:00", end="11:00", allDay=False),
            ],
        ),
        tomorrow=CalendarDay(count=0, firstStart=None, lastEnd=None, nextStart=None, events=[]),
    )
    out = build_instruction(_base_ctx(calendar_density=cd))
    assert "CALENDAR" in out
    assert "Standup" in out
    assert "1:1 Alex" in out


def test_profile_block_renders_yaml() -> None:
    out = build_instruction(
        _base_ctx(user_profile={"name": "Tim", "occupation": {"title": "Coach"}})
    )
    assert "USER_PROFILE" in out
    assert "name: Tim" in out
    assert "title: Coach" in out


def test_memories_block_only_when_present() -> None:
    out = build_instruction(_base_ctx(memories=[Memory(text="User has a dog called Cosmo.")]))
    assert "RELEVANT_MEMORIES" in out
    assert "Cosmo" in out


def test_nearby_places_block_only_when_location_and_places_present() -> None:
    location = LocationCtx(coord=Coord(lat=51.5, lng=-0.1), city="London", country="UK")
    out = build_instruction(
        _base_ctx(
            location=location,
            nearby_places=[NearbyPlace(name="Greenwich Park", type="park", address="London SE10")],
        )
    )
    assert "NEARBY_PLACES" in out
    assert "Greenwich Park" in out


# --- info_capture / post_tool_reflection toggling -----------------------


def test_info_capture_profile_only_when_memory_disabled() -> None:
    out = build_instruction(_base_ctx())
    assert "STRUCTURED facts" not in out  # only in the with-memory branch
    assert "update_user_profile" in out


def test_info_capture_with_memory_branch_when_memory_enabled() -> None:
    out = build_instruction(_base_ctx(memory_enabled=True))
    assert "STRUCTURED facts" in out
    assert "memory_save" in out


def test_post_tool_reflection_excludes_memory_save_when_disabled() -> None:
    out = build_instruction(_base_ctx())
    # Suffix substitution: when memory_enabled is False, no ", memory_save"
    # should land in the WRITE-tools list inside POST_TOOL_REFLECTION.
    assert "log_goal_update, update_user_profile)" in out
    assert "log_goal_update, update_user_profile, memory_save" not in out


def test_post_tool_reflection_includes_memory_save_when_enabled() -> None:
    out = build_instruction(_base_ctx(memory_enabled=True))
    assert "log_goal_update, update_user_profile, memory_save)" in out


# --- practice integration ------------------------------------------------


def test_practice_directive_appears_when_enabled_and_in_window() -> None:
    profile = {"practices": {"day_planning": {"enabled": True}}}
    out = build_instruction(_base_ctx(user_profile=profile))
    assert "DAY_PLANNING" in out


def test_available_practices_block_lists_disabled_practices() -> None:
    out = build_instruction(_base_ctx())
    assert "AVAILABLE_PRACTICES" in out
    # All three practices are disabled by default.
    assert "Plan the day" in out
    assert "Evening gratitude" in out
    assert "Journaling" in out
