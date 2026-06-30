"""Canonical UTC timestamp formatting for the background subsystem.

The schedule/run stores compare and order timestamps as strings (Firestore
range queries + lease-expiry checks). Lexicographic ordering is only correct
when every string has the *same* fixed width — `2026-…T08:00:00Z` sorts
AFTER `2026-…T08:00:00.5Z` (`.` < `Z`), so mixing fractional precisions would
silently misorder due schedules (PR #193 Codex review).

`canonical_iso` normalises any valid `…Z` ISO-8601 string to exactly
millisecond precision + `Z` — the same shape JS `Date.toISOString()` emits,
so the web and the agent produce identical, sortable strings.
"""

from __future__ import annotations

from datetime import UTC, datetime


def canonical_iso(ts: str) -> str:
    """Normalise an ISO-8601 timestamp to `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC)."""
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(UTC)
    millis = dt.microsecond // 1000
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{millis:03d}Z"


def now_iso() -> str:
    """Current time in the canonical millisecond-precision UTC form."""
    return canonical_iso(datetime.now(UTC).isoformat())
