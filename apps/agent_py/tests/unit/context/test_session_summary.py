"""Tests for `SessionSummaryClient`. Mirrors a subset of
`apps/agent/src/context/sessionSummary.test.ts` — the LLM-call-counting
and basic generation/cache scenarios."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from lifecoach_agent.context.session_summary import (
    SUMMARY_MAX_CHARS,
    SessionSummaryClient,
    SessionSummaryStore,
    transcript_from_events,
)


@dataclass
class _FakeEventPart:
    text: str | None


@dataclass
class _FakeContent:
    parts: list[_FakeEventPart]


@dataclass
class _FakeEvent:
    author: str
    content: _FakeContent


@dataclass
class _FakeSession:
    state: dict[str, Any] = field(default_factory=dict)
    events: list[_FakeEvent] = field(default_factory=list)


@dataclass
class _FakeStore(SessionSummaryStore):
    app_name: str = "lifecoach"
    sessions: dict[str, _FakeSession] = field(default_factory=dict)
    saves: list[dict[str, Any]] = field(default_factory=list)
    raise_on_get: bool = False

    async def get_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> _FakeSession | None:
        if self.raise_on_get:
            raise RuntimeError("boom")
        return self.sessions.get(f"{user_id}:{session_id}")

    async def save_summary(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        summary: str,
        generated_at: int,
    ) -> None:
        self.saves.append({"user_id": user_id, "session_id": session_id, "summary": summary})


def _ev(role: str, text: str) -> _FakeEvent:
    return _FakeEvent(author=role, content=_FakeContent(parts=[_FakeEventPart(text=text)]))


def test_transcript_from_events_drops_kickoff_tokens() -> None:
    events: list[Any] = [
        _ev("user", "__session_start__"),
        _ev("user", "hi"),
        _ev("model", "hello"),
        _ev("user", "__continue__"),
    ]
    out = transcript_from_events(events)
    assert "__session_start__" not in out
    assert "__continue__" not in out
    assert "User: hi" in out
    assert "Coach: hello" in out


@pytest.mark.asyncio
async def test_get_yesterday_returns_none_when_no_session() -> None:
    store = _FakeStore()

    async def summarizer(_t: str) -> str | None:
        return None

    client = SessionSummaryClient(store=store, summarizer=summarizer)
    assert await client.get_yesterday(uid="u1", today_date_local="2026-05-06") is None


@pytest.mark.asyncio
async def test_uses_cached_state_summary_without_llm_call() -> None:
    store = _FakeStore()
    store.sessions["u1:2026-05-05"] = _FakeSession(
        state={"summary": "cached", "summaryGeneratedAt": 1234},
    )
    calls = 0

    async def summarizer(_t: str) -> str | None:
        nonlocal calls
        calls += 1
        return "fresh"

    client = SessionSummaryClient(store=store, summarizer=summarizer)
    out = await client.get_yesterday(uid="u1", today_date_local="2026-05-06")
    assert out == "cached"
    assert calls == 0


@pytest.mark.asyncio
async def test_generates_summary_and_persists_when_missing() -> None:
    store = _FakeStore()
    store.sessions["u1:2026-05-05"] = _FakeSession(
        events=[_ev("user", "had a good run today and capped it with a long walk")],
    )

    async def summarizer(_t: str) -> str | None:
        return "  the user reflected on a good run and wind-down walk.  "

    client = SessionSummaryClient(store=store, summarizer=summarizer)
    out = await client.get_yesterday(uid="u1", today_date_local="2026-05-06")
    assert out is not None
    assert "good run" in out.lower()
    assert len(store.saves) == 1
    assert store.saves[0]["session_id"] == "2026-05-05"


@pytest.mark.asyncio
async def test_cache_avoids_repeat_llm_calls() -> None:
    store = _FakeStore()
    store.sessions["u1:2026-05-05"] = _FakeSession(
        events=[_ev("user", "talked about the report and the school run")],
    )
    calls = 0

    async def summarizer(_t: str) -> str | None:
        nonlocal calls
        calls += 1
        return "talked through report and school run"

    client = SessionSummaryClient(store=store, summarizer=summarizer)
    await client.get_yesterday(uid="u1", today_date_local="2026-05-06")
    await client.get_yesterday(uid="u1", today_date_local="2026-05-06")
    assert calls == 1


@pytest.mark.asyncio
async def test_skips_short_transcripts() -> None:
    store = _FakeStore()
    store.sessions["u1:2026-05-05"] = _FakeSession(events=[_ev("user", "hi")])
    calls = 0

    async def summarizer(_t: str) -> str | None:
        nonlocal calls
        calls += 1
        return "should not run"

    client = SessionSummaryClient(store=store, summarizer=summarizer)
    out = await client.get_yesterday(uid="u1", today_date_local="2026-05-06")
    assert out is None
    assert calls == 0


@pytest.mark.asyncio
async def test_get_week_returns_none_when_fewer_than_two_days() -> None:
    store = _FakeStore()
    store.sessions["u1:2026-05-05"] = _FakeSession(
        state={"summary": "only one day", "summaryGeneratedAt": 1},
    )

    async def summarizer(_t: str) -> str | None:
        return None

    client = SessionSummaryClient(store=store, summarizer=summarizer)
    assert await client.get_week(uid="u1", today_date_local="2026-05-12") is None


@pytest.mark.asyncio
async def test_summary_truncates_to_max() -> None:
    store = _FakeStore()
    store.sessions["u1:2026-05-05"] = _FakeSession(
        events=[_ev("user", "x" * 2000)],
    )

    async def summarizer(_t: str) -> str | None:
        return "z" * (SUMMARY_MAX_CHARS + 100)

    client = SessionSummaryClient(store=store, summarizer=summarizer)
    out = await client.get_yesterday(uid="u1", today_date_local="2026-05-06")
    assert out is not None
    assert len(out) <= SUMMARY_MAX_CHARS
    assert out.endswith("…")
