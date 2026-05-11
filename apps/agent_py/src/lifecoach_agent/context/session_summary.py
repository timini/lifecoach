"""Yesterday + 7-day rolling summary context for the system prompt.

Issue #10's design: each calendar-day session lives at
  apps/lifecoach/users/{uid}/sessions/{YYYY-MM-DD}
On every turn we want the agent to see (a) yesterday's one-paragraph
summary and (b) a 7-day rolling digest, without re-asking the user what
they were working on.

Mirrors `apps/agent/src/context/sessionSummary.ts`. Generation is lazy:
when today's turn fires and yesterday's session has events but no stored
summary, run a single Flash Lite call, persist, return. Subsequent
turns hit the in-memory cache.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

CACHE_TTL_S: float = 5 * 60.0
MIN_TRANSCRIPT_CHARS = 40
MAX_TRANSCRIPT_CHARS = 12_000
SUMMARY_MAX_CHARS = 600
WEEK_SUMMARY_MAX_CHARS = 1_200

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class DaySummary:
    summary: str
    generated_at: int  # epoch ms — kept for forward-compat (regen never fires today)


class SessionLike(Protocol):
    """Structural Session — only the bits this module reads. The full ADK
    Session has more, but we don't depend on it here."""

    state: dict[str, Any]
    events: list[Any]


class SessionSummaryStore(Protocol):
    """Persistence surface — the Firestore session store implements this
    in Phase 5 (`storage.firestore_session`)."""

    app_name: str

    async def get_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> SessionLike | None: ...

    async def save_summary(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        summary: str,
        generated_at: int,
    ) -> None: ...


# Pluggable summarizer. Returns one paragraph or None on decline / error.
# Production wiring uses gemini-flash-lite-latest via google-genai (see
# `session_summarizer.py`).
Summarizer = Callable[[str], Awaitable[str | None]]


def transcript_from_events(events: list[Any] | None) -> str:
    """Build a transcript for the Summarizer. Drops the synthetic
    `__session_start__` and `__continue__` kickoffs, trims to
    MAX_TRANSCRIPT_CHARS, labels each turn so the LLM knows who said what."""
    lines: list[str] = []
    for ev in events or []:
        content = getattr(ev, "content", None)
        parts = getattr(content, "parts", None) if content else None
        text_parts: list[str] = []
        for p in parts or []:
            t = getattr(p, "text", None)
            if isinstance(t, str):
                text_parts.append(t)
        text = re.sub(r"\s+", " ", " ".join(text_parts)).strip()
        if not text or text == "__session_start__":
            continue
        author = getattr(ev, "author", None)
        role = "User" if author == "user" else "Coach"
        lines.append(f"{role}: {text}")
    joined = "\n".join(lines)
    if len(joined) > MAX_TRANSCRIPT_CHARS:
        return joined[:MAX_TRANSCRIPT_CHARS]
    return joined


def _is_iso_date(s: str) -> bool:
    return bool(_ISO_DATE_RE.match(s))


def _shift_date(date_local: str, days: int) -> str:
    """UTC arithmetic over already-local YYYY-MM-DD keys. Adding a tz
    here would double-shift and produce wrong keys at midnight boundaries."""
    base = datetime.fromisoformat(f"{date_local}T00:00:00+00:00")
    shifted = base + timedelta(days=days)
    return shifted.astimezone(UTC).strftime("%Y-%m-%d")


@dataclass
class _CacheEntry:
    at: float
    value: DaySummary | None


class SessionSummaryClient:
    """In-memory-cached lazy summary client. Same surface as the TS
    `SessionSummaryClient`."""

    def __init__(
        self,
        *,
        store: SessionSummaryStore,
        summarizer: Summarizer,
        now: Callable[[], float] | None = None,
        ttl_s: float = CACHE_TTL_S,
    ) -> None:
        self._store = store
        self._summarizer = summarizer
        self._now = now or time.monotonic
        self._ttl = ttl_s
        self._cache: dict[str, _CacheEntry] = {}

    def _cache_key(self, uid: str, date_local: str) -> str:
        return f"{uid}:{date_local}"

    async def _get_or_generate(self, uid: str, date_local: str) -> DaySummary | None:
        if not _is_iso_date(date_local):
            return None
        key = self._cache_key(uid, date_local)
        now_t = self._now()
        hit = self._cache.get(key)
        if hit and now_t - hit.at < self._ttl:
            return hit.value

        try:
            session = await self._store.get_session(
                app_name=self._store.app_name, user_id=uid, session_id=date_local
            )
        except Exception:  # noqa: BLE001
            session = None
        if session is None:
            self._cache[key] = _CacheEntry(at=now_t, value=None)
            return None

        state = session.state or {}
        state_summary = state.get("summary")
        state_generated_at = state.get("summaryGeneratedAt")
        if isinstance(state_summary, str) and isinstance(state_generated_at, int):
            v = DaySummary(summary=state_summary, generated_at=state_generated_at)
            self._cache[key] = _CacheEntry(at=now_t, value=v)
            return v

        transcript = transcript_from_events(session.events)
        if len(transcript) < MIN_TRANSCRIPT_CHARS:
            self._cache[key] = _CacheEntry(at=now_t, value=None)
            return None

        try:
            summary = await self._summarizer(transcript)
        except Exception:  # noqa: BLE001
            summary = None
        if not summary or not summary.strip():
            self._cache[key] = _CacheEntry(at=now_t, value=None)
            return None

        if len(summary) > SUMMARY_MAX_CHARS:
            trimmed = summary[: SUMMARY_MAX_CHARS - 1].rstrip() + "…"
        else:
            trimmed = summary.strip()
        epoch_ms = int(datetime.now(UTC).timestamp() * 1000)
        v = DaySummary(summary=trimmed, generated_at=epoch_ms)
        # Persistence failure shouldn't block the turn — we still have the
        # value in-memory for the cache TTL window. Tomorrow's turn retries
        # the generation on cache miss + missing state.
        with contextlib.suppress(Exception):
            await self._store.save_summary(
                app_name=self._store.app_name,
                user_id=uid,
                session_id=date_local,
                summary=v.summary,
                generated_at=v.generated_at,
            )
        self._cache[key] = _CacheEntry(at=now_t, value=v)
        return v

    async def get_yesterday(self, *, uid: str, today_date_local: str) -> str | None:
        if not _is_iso_date(today_date_local):
            return None
        yesterday = _shift_date(today_date_local, -1)
        v = await self._get_or_generate(uid, yesterday)
        return v.summary if v else None

    async def get_week(self, *, uid: str, today_date_local: str) -> str | None:
        if not _is_iso_date(today_date_local):
            return None
        # Walk -7 → -1 so the digest reads chronologically. Resolve in
        # parallel; failures degrade to skipped days.
        dates = [_shift_date(today_date_local, -(7 - i)) for i in range(7)]

        async def safe_get(d: str) -> DaySummary | None:
            try:
                return await self._get_or_generate(uid, d)
            except Exception:  # noqa: BLE001
                return None

        items = await asyncio.gather(*(safe_get(d) for d in dates))
        lines = [f"{dates[i]}: {item.summary}" for i, item in enumerate(items) if item]
        if len(lines) < 2:
            return None
        joined = "\n".join(lines)
        if len(joined) > WEEK_SUMMARY_MAX_CHARS:
            return joined[: WEEK_SUMMARY_MAX_CHARS - 1].rstrip() + "…"
        return joined
