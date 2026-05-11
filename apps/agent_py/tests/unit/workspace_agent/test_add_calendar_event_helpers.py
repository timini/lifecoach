"""Unit tests for the date-math helpers behind `add_calendar_event`.

These are pure functions — covered here so a refactor can't silently
break end-default behaviour for either timed or all-day events.
The silent-passthrough on parse failure is deliberate (a malformed
input is left as-is for the Calendar API to reject loudly); the tests
document and lock that contract in.
"""

from __future__ import annotations

from lifecoach_agent.workspace_agent.tools.add_calendar_event import (
    _add_days_iso,
    _add_minutes,
)


# --- _add_days_iso (all-day events) --------------------------------------


def test_add_days_iso_basic_increment() -> None:
    assert _add_days_iso("2026-05-12", 1) == "2026-05-13"


def test_add_days_iso_month_rollover() -> None:
    assert _add_days_iso("2026-01-31", 1) == "2026-02-01"


def test_add_days_iso_year_rollover() -> None:
    assert _add_days_iso("2026-12-31", 1) == "2027-01-01"


def test_add_days_iso_silent_passthrough_on_bad_input() -> None:
    # Deliberate fallback — if the LLM emits a malformed date, we hand
    # it back so the Calendar API rejects loudly rather than the
    # default-end logic synthesising a worse one.
    assert _add_days_iso("not-a-date", 1) == "not-a-date"


# --- _add_minutes (timed events) -----------------------------------------


def test_add_minutes_preserves_offset() -> None:
    out = _add_minutes("2026-05-12T18:00:00+01:00", 30)
    assert out == "2026-05-12T18:30:00+01:00"


def test_add_minutes_preserves_utc_z_suffix() -> None:
    # "Z" is the canonical UTC suffix and the most common input from
    # the model — render it back as `Z`, not `+00:00`.
    out = _add_minutes("2026-05-12T18:00:00Z", 30)
    assert out.endswith("Z")
    assert "18:30:00" in out


def test_add_minutes_handles_negative_offset() -> None:
    out = _add_minutes("2026-05-12T18:00:00-05:00", 30)
    assert out == "2026-05-12T18:30:00-05:00"


def test_add_minutes_crosses_hour_boundary() -> None:
    out = _add_minutes("2026-05-12T18:45:00+01:00", 30)
    assert out == "2026-05-12T19:15:00+01:00"


def test_add_minutes_silent_passthrough_on_bad_input() -> None:
    assert _add_minutes("not-rfc3339", 30) == "not-rfc3339"
