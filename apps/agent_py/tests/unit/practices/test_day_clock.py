"""Sanity-checks for the local-clock helper."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from lifecoach_agent.practices.day_clock import local_date_and_hour


def test_local_date_and_hour_with_timezone() -> None:
    # 2026-05-06 07:00 UTC = 08:00 BST (UTC+1)
    now = datetime(2026, 5, 6, 7, 0, tzinfo=ZoneInfo("UTC"))
    date, hour = local_date_and_hour(now, "Europe/London")
    assert date == "2026-05-06"
    assert hour == 8


def test_local_date_and_hour_naive_datetime_treated_as_utc() -> None:
    now = datetime(2026, 5, 6, 7, 0)
    date, hour = local_date_and_hour(now, "Europe/London")
    assert date == "2026-05-06"
    assert hour == 8


def test_local_date_and_hour_no_timezone_falls_back_to_utc() -> None:
    now = datetime(2026, 5, 6, 7, 30, tzinfo=ZoneInfo("UTC"))
    date, hour = local_date_and_hour(now, None)
    assert date == "2026-05-06"
    assert hour == 7
