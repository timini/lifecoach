"""Smoke coverage for the remaining storage modules — enough to catch
regressions in the IO contract; deeper assertions live in the bigger
TS test suites we'll finish porting in a follow-up."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from lifecoach_agent.oauth.workspace_client import RefreshResult, WorkspaceTokens
from lifecoach_agent.storage.firestore_session import (
    create_firestore_session_service,
    save_session_summary,
)
from lifecoach_agent.storage.goal_updates import create_goal_updates_store, goal_updates_path
from lifecoach_agent.storage.profile_history import (
    ProfileHistoryEntry,
    create_profile_history_store,
)
from lifecoach_agent.storage.user_meta import create_user_meta_store
from lifecoach_agent.storage.workspace_tokens import (
    ScopeRequiredError,
    create_workspace_tokens_store,
)
from tests.unit.storage._fakes import FakeBucket, FakeFirestore

# --- profile_history ---


@pytest.mark.asyncio
async def test_profile_history_append_then_read() -> None:
    store = create_profile_history_store(bucket=FakeBucket())
    await store.append(
        "u1",
        ProfileHistoryEntry(path="name", before=None, after="Tim", at="2026-05-06T09:00:00Z"),
    )
    await store.append(
        "u1",
        ProfileHistoryEntry(path="age", before=None, after=42, at="2026-05-06T09:01:00Z"),
    )
    entries = await store.read("u1")
    assert len(entries) == 2
    assert entries[0].path == "name"
    assert entries[1].after == 42


@pytest.mark.asyncio
async def test_profile_history_limit_returns_recent() -> None:
    store = create_profile_history_store(bucket=FakeBucket())
    for i in range(5):
        await store.append(
            "u1",
            ProfileHistoryEntry(path=f"k{i}", before=None, after=i, at=f"2026-05-06T09:0{i}:00Z"),
        )
    out = await store.read("u1", limit=2)
    assert [e.path for e in out] == ["k3", "k4"]


# --- goal_updates ---


@pytest.mark.asyncio
async def test_goal_updates_append_and_recent() -> None:
    fixed = datetime(2026, 5, 6, 9, 0, tzinfo=UTC)
    store = create_goal_updates_store(bucket=FakeBucket(), now=lambda: fixed)
    full = await store.append("u1", goal="Run 5k", status="started")
    assert full.goal == "Run 5k"
    assert full.status == "started"
    assert full.timestamp.startswith("2026-05-06T")
    # `recent` returns last N
    await store.append("u1", goal="Read 1 book", status="started")
    recent = await store.recent("u1", limit=1)
    assert recent[-1].goal == "Read 1 book"


def test_goal_updates_path() -> None:
    assert goal_updates_path("u1") == "users/u1/goal_updates.json"


# --- user_meta ---


@pytest.mark.asyncio
async def test_user_meta_creates_then_increments() -> None:
    fs = FakeFirestore()
    store = create_user_meta_store(firestore=fs, now_ms=lambda: 1746522000000)
    first = await store.increment_turn_count("u1")
    assert first.chatTurnCount == 1
    second = await store.increment_turn_count("u1")
    assert second.chatTurnCount == 2


@pytest.mark.asyncio
async def test_user_meta_set_tier_creates_or_updates() -> None:
    fs = FakeFirestore()
    store = create_user_meta_store(firestore=fs, now_ms=lambda: 1746522000000)
    doc = await store.set_tier("u1", "pro")
    assert doc.tier == "pro"
    # turning back to free preserves chatTurnCount
    await store.increment_turn_count("u1")
    after_revert = await store.set_tier("u1", "free")
    assert after_revert.tier == "free"
    assert after_revert.chatTurnCount == 1


# --- firestore session ---


@pytest.mark.asyncio
async def test_firestore_session_create_get_delete() -> None:
    fs = FakeFirestore()
    svc = create_firestore_session_service(firestore=fs)
    session = await svc.create_session(app_name="lifecoach", user_id="u1", session_id="2026-05-06")
    # The service now extends ADK's BaseSessionService and returns a real
    # `Session` (PR #56 cutover — TS-style dict return broke the runtime
    # `session.events` access path the runner uses).
    assert session.id == "2026-05-06"
    assert session.app_name == "lifecoach"
    assert session.user_id == "u1"
    fetched = await svc.get_session(app_name="lifecoach", user_id="u1", session_id="2026-05-06")
    assert fetched is not None and fetched.id == "2026-05-06"
    await svc.delete_session(app_name="lifecoach", user_id="u1", session_id="2026-05-06")
    assert (
        await svc.get_session(app_name="lifecoach", user_id="u1", session_id="2026-05-06") is None
    )


@pytest.mark.asyncio
async def test_get_session_strips_legacy_recovery_events() -> None:
    """Sessions written by the now-removed empty-turn guard contain
    `recovery-*`-id model events that poisoned subsequent turns
    (Gemini mimicked the user→"Done. What next?" pattern). The current
    `FirestoreSessionService.get_session` strips them on rehydrate so
    existing sessions self-heal once the guard is gone.
    """
    fs = FakeFirestore()
    svc = create_firestore_session_service(firestore=fs)
    await svc.create_session(app_name="lifecoach", user_id="u1", session_id="legacy-day")
    # Inject a poisoned events list straight into storage to mirror the
    # Firestore docs the legacy guard wrote.
    poisoned_events = [
        {
            "id": "real-1",
            "author": "user",
            "content": {"role": "user", "parts": [{"text": "check my emails"}]},
            "timestamp": 1,
        },
        {
            "id": "recovery-legacy-day-12345-abc",
            "author": "lifecoach",
            "content": {"role": "model", "parts": [{"text": "Done. What next?"}]},
            "timestamp": 2,
        },
        {
            "id": "real-2",
            "author": "user",
            "content": {"role": "user", "parts": [{"text": "hello?"}]},
            "timestamp": 3,
        },
        {
            "id": "recovery-gap-end-deadbeef",
            "author": "lifecoach",
            "content": {"role": "model", "parts": [{"text": "Done. What next?"}]},
            "timestamp": 4,
        },
    ]
    await fs.doc("apps/lifecoach/users/u1/sessions/legacy-day").set(
        {
            "id": "legacy-day",
            "appName": "lifecoach",
            "userId": "u1",
            "state": {},
            "events": poisoned_events,
            "lastUpdateTime": 5,
        }
    )

    fetched = await svc.get_session(app_name="lifecoach", user_id="u1", session_id="legacy-day")
    assert fetched is not None
    ids = [e.id for e in fetched.events]
    assert ids == ["real-1", "real-2"], (
        f"recovery-* ids should be filtered out on load; got: {ids}"
    )


@pytest.mark.asyncio
async def test_save_session_summary_merges_into_state() -> None:
    fs = FakeFirestore()
    svc = create_firestore_session_service(firestore=fs)
    await svc.create_session(
        app_name="lifecoach",
        user_id="u1",
        session_id="2026-05-05",
        state={"turn_count": 3},
    )
    await save_session_summary(
        firestore=fs,
        app_name="lifecoach",
        user_id="u1",
        session_id="2026-05-05",
        summary="they reflected on a good run",
        generated_at=1746522000000,
    )
    fetched = await svc.get_session(app_name="lifecoach", user_id="u1", session_id="2026-05-05")
    assert fetched is not None
    assert fetched.state["summary"] == "they reflected on a good run"
    assert fetched.state["summaryGeneratedAt"] == 1746522000000
    # Pre-existing state is preserved.
    assert fetched.state["turn_count"] == 3


# --- workspace_tokens ---


class _FakeOAuth:
    def __init__(
        self, *, refresh_result: RefreshResult | None = None, raises: bool = False
    ) -> None:
        self.calls: list[str] = []
        self.refresh_result = refresh_result
        self.raises = raises

    async def exchange_code(self, code: str) -> WorkspaceTokens:
        raise NotImplementedError

    async def refresh_access_token(self, refresh_token: str) -> RefreshResult:
        self.calls.append(refresh_token)
        if self.raises:
            raise RuntimeError("revoked")
        assert self.refresh_result is not None
        return self.refresh_result

    async def revoke_refresh_token(self, refresh_token: str) -> None:
        return None


@pytest.mark.asyncio
async def test_workspace_tokens_set_then_get_returns_valid_token() -> None:
    fs = FakeFirestore()
    expires_at = "2099-01-01T00:00:00.000Z"
    store = create_workspace_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(),
        now_ms=lambda: 1746522000000,
    )
    await store.set(
        "u1",
        WorkspaceTokens(
            accessToken="A", accessTokenExpiresAt=expires_at, refreshToken="R", scopes=["s1"]
        ),
    )
    token = await store.get_valid_access_token("u1")
    assert token == "A"


@pytest.mark.asyncio
async def test_workspace_tokens_refreshes_when_near_expiry() -> None:
    fs = FakeFirestore()
    fake_oauth = _FakeOAuth(
        refresh_result=RefreshResult(
            accessToken="A2",
            accessTokenExpiresAt="2099-01-01T00:00:00.000Z",
            refreshToken=None,
        )
    )
    store = create_workspace_tokens_store(
        firestore=fs,
        oauth_client=fake_oauth,
        now_ms=lambda: 1746522000000,
    )
    # Stored expiry is ms-precision into the past.
    await store.set(
        "u1",
        WorkspaceTokens(
            accessToken="A",
            accessTokenExpiresAt="2020-01-01T00:00:00.000Z",
            refreshToken="R",
            scopes=["s1"],
        ),
    )
    token = await store.get_valid_access_token("u1")
    assert token == "A2"
    assert fake_oauth.calls == ["R"]


@pytest.mark.asyncio
async def test_workspace_tokens_raises_scope_required_when_no_doc() -> None:
    fs = FakeFirestore()
    store = create_workspace_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(),
        now_ms=lambda: 1746522000000,
    )
    with pytest.raises(ScopeRequiredError):
        await store.get_valid_access_token("u1")


@pytest.mark.asyncio
async def test_workspace_tokens_deletes_on_refresh_failure() -> None:
    fs = FakeFirestore()
    store = create_workspace_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(raises=True),
        now_ms=lambda: 1746522000000,
    )
    await store.set(
        "u1",
        WorkspaceTokens(
            accessToken="A",
            accessTokenExpiresAt="2020-01-01T00:00:00.000Z",
            refreshToken="R",
            scopes=["s1"],
        ),
    )
    with pytest.raises(ScopeRequiredError):
        await store.get_valid_access_token("u1")
    # Doc deleted on revoke.
    assert await store.get("u1") is None
