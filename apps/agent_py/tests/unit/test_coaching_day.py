from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from lifecoach_agent.coaching_day import coaching_date_and_hour, coaching_day_key


def test_early_hours_belong_to_previous_coaching_day() -> None:
    at = datetime(2026, 8, 15, 4, 59, tzinfo=ZoneInfo("Europe/London"))
    assert coaching_date_and_hour(at, "Europe/London") == ("2026-08-14", 4)


def test_coaching_day_rolls_at_five_local() -> None:
    at = datetime(2026, 8, 15, 5, 0, tzinfo=ZoneInfo("Europe/London"))
    assert coaching_date_and_hour(at, "Europe/London") == ("2026-08-15", 5)


def test_timezone_is_applied_before_coaching_day_boundary() -> None:
    at = datetime(2026, 8, 15, 7, 30, tzinfo=ZoneInfo("UTC"))  # 03:30 in New York
    assert coaching_day_key(at, "America/New_York") == "2026-08-14"


def test_naive_datetime_is_treated_as_utc() -> None:
    assert coaching_day_key(datetime(2026, 8, 15, 0, 30), None) == "2026-08-14"
