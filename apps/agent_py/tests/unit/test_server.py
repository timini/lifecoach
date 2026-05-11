"""Tests for `lifecoach_agent.server` — the FastAPI app that wires
Phases 0–8 together for /chat, /history, /sessions, /profile, /goals
and the workspace OAuth endpoints.

Mirrors the breadth of `apps/agent/src/server.test.ts`. Drives the app
via `httpx.ASGITransport` so we don't need a running uvicorn.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from lifecoach_agent.auth import FirebaseClaim, VerifiedClaims
from lifecoach_agent.oauth.workspace_client import RefreshResult, WorkspaceTokens
from lifecoach_agent.server import (
    CreateAppDeps,
    RunnerForParams,
    SessionReader,
    create_app,
)
from lifecoach_agent.storage.firestore_session import create_firestore_session_service
from lifecoach_agent.storage.profile_history import (
    ProfileHistoryEntry,
    create_profile_history_store,
)
from lifecoach_agent.storage.user_profile import create_user_profile_store
from lifecoach_agent.storage.workspace_tokens import create_workspace_tokens_store
from tests.unit.storage._fakes import FakeBucket, FakeFirestore

# --- Fakes ---------------------------------------------------------------


@dataclass
class FakeSessionService:
    """Minimal Runner.session_service surface — create + get + append."""

    sessions: dict[str, dict[str, Any]] = field(default_factory=dict)
    appended: list[dict[str, Any]] = field(default_factory=list)

    async def create_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> dict[str, Any]:
        sess: dict[str, Any] = {
            "id": session_id,
            "appName": app_name,
            "userId": user_id,
            "events": [],
            "state": {},
            "lastUpdateTime": 0,
        }
        self.sessions[session_id] = sess
        return sess

    async def get_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return self.sessions.get(session_id)

    async def append_event(
        self, *, session: dict[str, Any], event: dict[str, Any]
    ) -> dict[str, Any]:
        self.appended.append(event)
        return event


@dataclass
class FakeRunner:
    """Yields whatever events are passed in — once per `run_async` call.

    `events_per_call` is consumed left-to-right; entries beyond the
    first are no-ops today but kept for tests that need multi-call
    runners in future."""

    events_per_call: list[list[dict[str, Any]]]
    raise_on_call: int | None = None
    app_name: str = "lifecoach"
    session_service: FakeSessionService = field(default_factory=FakeSessionService)
    calls_made: int = 0

    def run_async(self, **_kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        idx = self.calls_made
        self.calls_made += 1

        async def gen() -> AsyncIterator[dict[str, Any]]:
            if self.raise_on_call is not None and idx == self.raise_on_call:
                raise RuntimeError("boom")
            evs = self.events_per_call[idx] if idx < len(self.events_per_call) else []
            for e in evs:
                yield e

        return gen()


def _model_text(text: str) -> dict[str, Any]:
    return {
        "author": "lifecoach",
        "content": {"role": "model", "parts": [{"text": text}]},
    }


def _make_app(
    *,
    runner: FakeRunner | None = None,
    deps_overrides: dict[str, Any] | None = None,
) -> Any:
    runner = runner or FakeRunner(events_per_call=[[_model_text("hi!")]])

    def runner_for(_params: RunnerForParams) -> Any:
        return runner

    deps_kwargs: dict[str, Any] = {
        "runner_for": runner_for,
        "now": lambda: datetime(2026, 5, 6, 9, 0, tzinfo=ZoneInfo("UTC")),
    }
    if deps_overrides:
        deps_kwargs.update(deps_overrides)
    return create_app(CreateAppDeps(**deps_kwargs))


def _client(app: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# --- /health -------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_returns_ok() -> None:
    app = _make_app()
    async with _client(app) as c:
        res = await c.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


# --- /history ------------------------------------------------------------


class _FakeReader(SessionReader):
    """Minimal `SessionReader` impl backed by an in-memory dict."""

    app_name: str = "lifecoach"

    def __init__(
        self,
        sessions: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self._sessions = sessions or {}

    async def get_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return self._sessions.get(session_id)

    async def list_sessions(self, *, app_name: str, user_id: str) -> list[Any]:
        return list(self._sessions.values())


@pytest.mark.asyncio
async def test_history_returns_events_for_known_session() -> None:
    reader = _FakeReader(
        sessions={
            "sess-1": {
                "id": "sess-1",
                "events": [_model_text("yo")],
                "lastUpdateTime": 100,
            }
        }
    )
    app = _make_app(deps_overrides={"session_reader": reader})
    async with _client(app) as c:
        res = await c.get("/history?userId=u1&sessionId=sess-1")
    assert res.status_code == 200
    body = res.json()
    assert len(body["events"]) == 1
    assert body["events"][0]["content"]["parts"][0]["text"] == "yo"


@pytest.mark.asyncio
async def test_history_returns_400_when_query_missing() -> None:
    app = _make_app()
    async with _client(app) as c:
        res = await c.get("/history?userId=u1")
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_history_requires_auth_when_required() -> None:
    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1")

    app = _make_app(deps_overrides={"verify_token": _verifier, "require_auth": True})
    async with _client(app) as c:
        # No Bearer header → 401.
        res = await c.get("/history?userId=u1&sessionId=s1")
    assert res.status_code == 401


# --- /sessions -----------------------------------------------------------


@pytest.mark.asyncio
async def test_sessions_returns_sorted_metadata_descending() -> None:
    reader = _FakeReader(
        sessions={
            "a": {"id": "a", "lastUpdateTime": 100, "events": []},
            "b": {"id": "b", "lastUpdateTime": 300, "events": []},
            "c": {"id": "c", "lastUpdateTime": 200, "events": []},
        }
    )

    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1")

    app = _make_app(deps_overrides={"session_reader": reader, "verify_token": _verifier})
    async with _client(app) as c:
        res = await c.get("/sessions", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200
    items = res.json()["sessions"]
    assert [it["sessionId"] for it in items] == ["b", "c", "a"]


@pytest.mark.asyncio
async def test_sessions_returns_empty_when_unauthenticated_without_required() -> None:
    """Without a verify_token the uid scope is unknown → empty list (matches
    TS fallback). Distinct from the 401-on-required-auth case."""
    app = _make_app()
    async with _client(app) as c:
        res = await c.get("/sessions")
    assert res.status_code == 200
    assert res.json() == {"sessions": []}


# --- /profile ------------------------------------------------------------


@pytest.mark.asyncio
async def test_profile_get_then_patch_round_trip() -> None:
    bucket = FakeBucket()
    profile_store = create_user_profile_store(bucket=bucket)
    history = create_profile_history_store(bucket=bucket)
    await history.append(
        "u1",
        ProfileHistoryEntry(path="name", before=None, after="Tim", at="2026-05-06T09:00:00Z"),
    )

    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1")

    app = _make_app(
        deps_overrides={
            "profile_store": profile_store,
            "profile_history_store": history,
            "verify_token": _verifier,
        }
    )
    async with _client(app) as c:
        # GET — token uid (u1) overrides the query uid.
        res = await c.get("/profile?userId=u-other", headers={"Authorization": "Bearer x"})
        assert res.status_code == 200
        assert res.json()["history"][0]["path"] == "name"

        # PATCH — round-trip a profile object.
        patch = await c.patch(
            "/profile",
            json={"profile": {"name": "Tim", "city": "London"}},
            headers={"Authorization": "Bearer x"},
        )
        assert patch.status_code == 200
        again = await c.get("/profile?userId=u1", headers={"Authorization": "Bearer x"})
        assert again.json()["profile"]["name"] == "Tim"
        assert again.json()["profile"]["city"] == "London"


@pytest.mark.asyncio
async def test_profile_patch_requires_auth_even_without_require_auth_flag() -> None:
    """Direct profile writes always need a verified token, regardless of
    `require_auth` — protects against a malicious client overwriting an
    arbitrary uid's data."""
    bucket = FakeBucket()
    profile_store = create_user_profile_store(bucket=bucket)
    app = _make_app(deps_overrides={"profile_store": profile_store})
    async with _client(app) as c:
        res = await c.patch("/profile", json={"profile": {"name": "x"}})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_profile_patch_validates_body_shape() -> None:
    """Non-object profile is rejected with 400 (same as TS surface)."""

    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1")

    bucket = FakeBucket()
    profile_store = create_user_profile_store(bucket=bucket)
    app = _make_app(deps_overrides={"profile_store": profile_store, "verify_token": _verifier})
    async with _client(app) as c:
        res = await c.patch(
            "/profile",
            json={"profile": "string-not-object"},
            headers={"Authorization": "Bearer x"},
        )
    assert res.status_code == 400


# --- /workspace ----------------------------------------------------------


class _FakeOAuth:
    """Fake `WorkspaceOAuthClient` for the exchange / revoke happy paths.
    Refresh isn't exercised by the server endpoints (only the store)."""

    async def exchange_code(self, code: str) -> WorkspaceTokens:
        if code == "BAD":
            raise RuntimeError("nope")
        return WorkspaceTokens(
            accessToken="A",
            accessTokenExpiresAt="2099-01-01T00:00:00.000Z",
            refreshToken="R",
            scopes=["s1", "s2"],
        )

    async def refresh_access_token(self, refresh_token: str) -> RefreshResult:
        raise NotImplementedError

    async def revoke_refresh_token(self, refresh_token: str) -> None:
        return None


def _make_workspace_app() -> tuple[Any, Any]:
    fs = FakeFirestore()
    oauth = _FakeOAuth()
    store = create_workspace_tokens_store(firestore=fs, oauth_client=oauth)

    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1")

    app = _make_app(
        deps_overrides={
            "workspace_tokens_store": store,
            "workspace_oauth_client": oauth,
            "verify_token": _verifier,
        }
    )
    return app, store


@pytest.mark.asyncio
async def test_workspace_status_returns_disconnected_when_no_doc() -> None:
    app, _store = _make_workspace_app()
    async with _client(app) as c:
        res = await c.get("/workspace/status", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200
    assert res.json() == {"connected": False, "scopes": [], "grantedAt": None}


@pytest.mark.asyncio
async def test_workspace_oauth_exchange_happy_path_persists_token() -> None:
    app, store = _make_workspace_app()
    async with _client(app) as c:
        res = await c.post(
            "/workspace/oauth-exchange",
            json={"code": "good-code"},
            headers={"Authorization": "Bearer x"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["connected"] is True
    assert body["scopes"] == ["s1", "s2"]
    # Persisted in the store; never echoed back as token material.
    saved = await store.get("u1")
    assert saved is not None
    assert saved.refreshToken == "R"


@pytest.mark.asyncio
async def test_workspace_oauth_exchange_failure_returns_400() -> None:
    app, _store = _make_workspace_app()
    async with _client(app) as c:
        res = await c.post(
            "/workspace/oauth-exchange",
            json={"code": "BAD"},
            headers={"Authorization": "Bearer x"},
        )
    assert res.status_code == 400
    assert res.json() == {"error": "oauth_exchange_failed"}


@pytest.mark.asyncio
async def test_workspace_status_requires_auth() -> None:
    app, _store = _make_workspace_app()
    async with _client(app) as c:
        res = await c.get("/workspace/status")
    assert res.status_code == 401


# --- /chat ---------------------------------------------------------------


async def _drain(res: httpx.Response) -> str:
    body = b""
    async for chunk in res.aiter_bytes():
        body += chunk
    return body.decode("utf-8")


@pytest.mark.asyncio
async def test_chat_streams_model_text_and_terminates_with_done() -> None:
    runner = FakeRunner(events_per_call=[[_model_text("hello there")]])
    app = _make_app(runner=runner)
    async with (
        _client(app) as c,
        c.stream(
            "POST",
            "/chat",
            json={"userId": "u1", "sessionId": "s1", "message": "hi"},
        ) as res,
    ):
        text = await _drain(res)
    assert "hello there" in text
    assert "event: done" in text


@pytest.mark.asyncio
async def test_chat_400_when_required_fields_missing() -> None:
    app = _make_app()
    async with _client(app) as c:
        res = await c.post("/chat", json={"message": "hi"})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_chat_streams_text_when_model_responds() -> None:
    """Happy-path sanity — model emits text, FE receives it, `event:
    done` terminates. The only chat-level test we need; everything else
    around silent turns is the judged chat-quality e2e's problem."""
    runner = FakeRunner(events_per_call=[[_model_text("hi back")]])
    app = _make_app(runner=runner)
    async with (
        _client(app) as c,
        c.stream(
            "POST",
            "/chat",
            json={"userId": "u1", "sessionId": "s1", "message": "hi"},
        ) as res,
    ):
        text = await _drain(res)
    assert "hi back" in text
    assert "event: done" in text


@pytest.mark.asyncio
async def test_chat_emits_initial_padding_comment_to_flush_gfe_buffer() -> None:
    """Ensure the leading 4096-space comment is present so Cloud Run's
    Google Frontend forwards subsequent chunks immediately."""
    runner = FakeRunner(events_per_call=[[_model_text("ok")]])
    app = _make_app(runner=runner)
    async with (
        _client(app) as c,
        c.stream(
            "POST",
            "/chat",
            json={"userId": "u1", "sessionId": "s1", "message": "hi"},
        ) as res,
    ):
        text = await _drain(res)
    # First line is `: <4096 spaces>\n\n`. Use a length-based check.
    assert text.startswith(": " + (" " * 4096))


@pytest.mark.asyncio
async def test_chat_uses_token_uid_over_body_uid_for_scoped_reads() -> None:
    """When auth verifies, the claims uid drives downstream stores —
    body's userId is just a hint (preserved for back-compat)."""
    seen_uids: list[str] = []
    bucket = FakeBucket()
    profile_store = create_user_profile_store(bucket=bucket)

    class _Tracking:
        async def read(self, uid: str) -> Any:
            seen_uids.append(uid)
            return await profile_store.read(uid)

        async def write(self, uid: str, profile: Any) -> None:
            await profile_store.write(uid, profile)

        async def update_path(self, uid: str, path: str, value: Any) -> Any:
            return await profile_store.update_path(uid, path, value)

        async def read_path(self, uid: str, path: str) -> Any:
            return await profile_store.read_path(uid, path)

    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="real-uid", firebase=FirebaseClaim(sign_in_provider="google.com"))

    runner = FakeRunner(events_per_call=[[_model_text("ok")]])
    app = _make_app(
        runner=runner,
        deps_overrides={
            "profile_store": _Tracking(),  # type: ignore[arg-type]
            "verify_token": _verifier,
        },
    )
    async with (
        _client(app) as c,
        c.stream(
            "POST",
            "/chat",
            json={"userId": "spoofed", "sessionId": "s1", "message": "hi"},
            headers={"Authorization": "Bearer x"},
        ) as res,
    ):
        await _drain(res)
    assert "real-uid" in seen_uids
    assert "spoofed" not in seen_uids


# --- /goals --------------------------------------------------------------


@pytest.mark.asyncio
async def test_goals_returns_recent_updates() -> None:
    """Smoke-check: with a real GoalUpdatesStore wired, /goals serialises
    the recent entries in JSON the web client expects."""
    from lifecoach_agent.storage.goal_updates import create_goal_updates_store

    bucket = FakeBucket()
    store = create_goal_updates_store(
        bucket=bucket,
        now=lambda: datetime(2026, 5, 6, 9, 0, tzinfo=ZoneInfo("UTC")),
    )
    await store.append("u1", goal="Run 5k", status="started")

    app = _make_app(deps_overrides={"goal_updates_store": store})
    async with _client(app) as c:
        res = await c.get("/goals?userId=u1")
    assert res.status_code == 200
    body = res.json()
    assert body["updates"][0]["goal"] == "Run 5k"


# --- /history rehydration through a real Firestore session service ------


@pytest.mark.asyncio
async def test_history_serves_session_round_trip_via_firestore_service() -> None:
    """Higher-fidelity check that the SessionReader Protocol the server
    consumes is satisfied by `FirestoreSessionService` (production
    wiring) — independent of the test fakes used elsewhere."""
    fs = FakeFirestore()
    svc = create_firestore_session_service(firestore=fs)
    await svc.create_session(app_name="lifecoach", user_id="u1", session_id="day-1")

    class _Reader(SessionReader):
        app_name: str = "lifecoach"

        async def get_session(self, *, app_name: str, user_id: str, session_id: str) -> Any | None:
            return await svc.get_session(app_name=app_name, user_id=user_id, session_id=session_id)

        async def list_sessions(self, *, app_name: str, user_id: str) -> list[Any]:
            return await svc.list_sessions(app_name=app_name, user_id=user_id)

    app = _make_app(deps_overrides={"session_reader": _Reader()})
    async with _client(app) as c:
        res = await c.get("/history?userId=u1&sessionId=day-1")
    assert res.status_code == 200
    assert res.json() == {"events": []}
