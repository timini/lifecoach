"""Unit tests for cadence → next-run-time + input-window (ADR 0001 step 5a)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from lifecoach_agent.background.schedule_time import input_window, next_run_at
from lifecoach_agent.contracts.background import ScheduleCadence


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _cadence_weekday(dt: datetime) -> int:
    return (dt.weekday() + 1) % 7


def test_daily_next_day_same_local_time_utc() -> None:
    cadence = ScheduleCadence(type="daily", localTime="08:00")
    # 08:00:01 UTC → next 08:00 is the following day.
    out = next_run_at(cadence, "UTC", after_iso="2026-05-15T08:00:01Z")
    assert out == "2026-05-16T08:00:00.000Z"


def test_daily_same_day_when_before_local_time() -> None:
    cadence = ScheduleCadence(type="daily", localTime="08:00")
    # 06:00 UTC, today's 08:00 hasn't passed → same day.
    out = next_run_at(cadence, "UTC", after_iso="2026-05-15T06:00:00Z")
    assert out == "2026-05-15T08:00:00.000Z"


def test_daily_preserves_local_time_across_dst_spring_forward() -> None:
    # America/New_York springs forward (EST→EDT) in March; the offset changes
    # but the *local* fire time must stay 08:00 — proving zoneinfo handling.
    cadence = ScheduleCadence(type="daily", localTime="08:00")
    out = next_run_at(cadence, "America/New_York", after_iso="2026-03-07T13:00:01Z")
    local = _parse(out).astimezone(ZoneInfo("America/New_York"))
    assert (local.hour, local.minute) == (8, 0)
    assert local.date().isoformat() == "2026-03-08"  # the DST-start day


def test_weekday_filter_skips_to_next_allowed_day() -> None:
    # Weekdays Mon..Fri (cadence convention 1..5). The result must land on an
    # allowed day, be strictly after the input, and keep the local time.
    cadence = ScheduleCadence(type="daily", localTime="09:00", weekdays=[1, 2, 3, 4, 5])
    after = "2026-06-13T10:00:00Z"  # a Saturday in UTC terms
    out = next_run_at(cadence, "UTC", after_iso=after)
    result = _parse(out)
    assert result > _parse(after)
    assert _cadence_weekday(result) in {1, 2, 3, 4, 5}
    assert (result.hour, result.minute) == (9, 0)


def test_weekday_filter_single_day_lands_on_that_day() -> None:
    cadence = ScheduleCadence(type="daily", localTime="07:30", weekdays=[0])  # Sundays only
    out = next_run_at(cadence, "UTC", after_iso="2026-06-15T08:00:00Z")  # a Monday-ish
    result = _parse(out)
    assert _cadence_weekday(result) == 0
    assert (result.hour, result.minute) == (7, 30)


def test_input_window_durations() -> None:
    sf = "2026-05-15T08:00:00.000Z"
    assert input_window("12h", scheduled_for_iso=sf) == ("2026-05-14T20:00:00.000Z", sf)
    assert input_window("1d", scheduled_for_iso=sf) == ("2026-05-14T08:00:00.000Z", sf)
    assert input_window("3d", scheduled_for_iso=sf) == ("2026-05-12T08:00:00.000Z", sf)


def test_input_window_rejects_unknown() -> None:
    import pytest

    with pytest.raises(ValueError, match="unknown lookbackWindow"):
        input_window("7d", scheduled_for_iso="2026-05-15T08:00:00.000Z")
