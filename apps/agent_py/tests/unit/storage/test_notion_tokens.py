"""Tests for the Notion tokens store. Mirrors test_storage_smoke's
workspace_tokens shape — fake firestore + fake oauth client."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.oauth.notion_client import (
    NotionRefreshResult,
    NotionTokens,
)
from lifecoach_agent.storage.notion_tokens import (
    NotionScopeRequiredError,
    create_notion_tokens_store,
)
from tests.unit.storage._fakes import FakeFirestore


class _FakeOAuth:
    def __init__(
        self, *, refresh_result: NotionRefreshResult | None = None, raises: bool = False
    ) -> None:
        self.calls: list[str] = []
        self.refresh_result = refresh_result
        self.raises = raises

    async def exchange_code(self, code: str, redirect_uri: str) -> NotionTokens:
        raise NotImplementedError

    async def refresh_access_token(self, refresh_token: str) -> NotionRefreshResult:
        self.calls.append(refresh_token)
        if self.raises:
            raise RuntimeError("notion-revoked")
        assert self.refresh_result is not None
        return self.refresh_result


def _tokens(
    *,
    access: str = "AT",
    expires: str = "2099-01-01T00:00:00.000Z",
    refresh: str = "RT",
) -> NotionTokens:
    return NotionTokens(
        accessToken=access,
        accessTokenExpiresAt=expires,
        refreshToken=refresh,
        botId="bot-1",
        workspaceId="ws-1",
        workspaceName="Test Notion",
        owner={"type": "user"},
    )


@pytest.mark.asyncio
async def test_set_then_get_returns_valid_token() -> None:
    fs = FakeFirestore()
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(),
        now_ms=lambda: 1746522000000,
    )
    await store.set("u1", _tokens())
    token = await store.get_valid_access_token("u1")
    assert token == "AT"


@pytest.mark.asyncio
async def test_refreshes_when_near_expiry() -> None:
    fs = FakeFirestore()
    fake_oauth = _FakeOAuth(
        refresh_result=NotionRefreshResult(
            accessToken="AT2",
            accessTokenExpiresAt="2099-01-01T00:00:00.000Z",
            refreshToken=None,
        )
    )
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=fake_oauth,
        now_ms=lambda: 1746522000000,
    )
    await store.set("u1", _tokens(expires="2020-01-01T00:00:00.000Z"))
    token = await store.get_valid_access_token("u1")
    assert token == "AT2"
    assert fake_oauth.calls == ["RT"]
    # Refresh token unchanged because Notion didn't rotate.
    doc = await store.get("u1")
    assert doc is not None and doc.refreshToken == "RT"


@pytest.mark.asyncio
async def test_rotated_refresh_token_is_persisted() -> None:
    fs = FakeFirestore()
    fake_oauth = _FakeOAuth(
        refresh_result=NotionRefreshResult(
            accessToken="AT2",
            accessTokenExpiresAt="2099-01-01T00:00:00.000Z",
            refreshToken="RT2",
        )
    )
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=fake_oauth,
        now_ms=lambda: 1746522000000,
    )
    await store.set("u1", _tokens(expires="2020-01-01T00:00:00.000Z"))
    await store.get_valid_access_token("u1")
    doc = await store.get("u1")
    assert doc is not None and doc.refreshToken == "RT2"


@pytest.mark.asyncio
async def test_scope_required_when_no_doc() -> None:
    fs = FakeFirestore()
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(),
        now_ms=lambda: 1746522000000,
    )
    with pytest.raises(NotionScopeRequiredError):
        await store.get_valid_access_token("u1")


@pytest.mark.asyncio
async def test_deletes_doc_on_refresh_failure() -> None:
    """User revoked the integration at notion.so → refresh fails →
    we delete our doc so state collapses to 'not connected' on the
    next chat turn."""
    fs = FakeFirestore()
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(raises=True),
        now_ms=lambda: 1746522000000,
    )
    await store.set("u1", _tokens(expires="2020-01-01T00:00:00.000Z"))
    with pytest.raises(NotionScopeRequiredError):
        await store.get_valid_access_token("u1")
    assert await store.get("u1") is None


@pytest.mark.asyncio
async def test_concurrent_refresh_dogpile_mutex() -> None:
    """Two simultaneous chat turns both find an expired token; only
    ONE refresh call hits Notion. Verified by counting calls on the
    fake oauth client after `asyncio.gather`."""
    import asyncio

    fs = FakeFirestore()
    fake_oauth = _FakeOAuth(
        refresh_result=NotionRefreshResult(
            accessToken="AT2",
            accessTokenExpiresAt="2099-01-01T00:00:00.000Z",
            refreshToken=None,
        )
    )
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=fake_oauth,
        now_ms=lambda: 1746522000000,
    )
    await store.set("u1", _tokens(expires="2020-01-01T00:00:00.000Z"))

    tokens = await asyncio.gather(
        store.get_valid_access_token("u1"),
        store.get_valid_access_token("u1"),
        store.get_valid_access_token("u1"),
    )
    assert tokens == ["AT2", "AT2", "AT2"]
    # Mutex collapsed three callers onto a single refresh.
    assert len(fake_oauth.calls) == 1


@pytest.mark.asyncio
async def test_set_preserves_grantedAt_across_writes() -> None:  # noqa: N802
    """First set seeds grantedAt; subsequent sets (e.g. on re-grant)
    keep the original grantedAt — same shape as workspace tokens."""
    fs = FakeFirestore()
    times: list[int] = []

    def _now_ms() -> int:
        # First call: t0; subsequent calls advance by 1 hour each.
        times.append(1_700_000_000_000 + 3600_000 * len(times))
        return times[-1]

    store = create_notion_tokens_store(firestore=fs, oauth_client=_FakeOAuth(), now_ms=_now_ms)
    first = await store.set("u1", _tokens())
    second = await store.set("u1", _tokens(access="AT2"))
    assert first.grantedAt == second.grantedAt
    assert second.updatedAt != first.updatedAt


@pytest.mark.asyncio
async def test_delete_removes_doc() -> None:
    fs = FakeFirestore()
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(),
        now_ms=lambda: 1746522000000,
    )
    await store.set("u1", _tokens())
    await store.delete("u1")
    assert await store.get("u1") is None


@pytest.mark.asyncio
async def test_doc_shape_round_trips_workspace_metadata() -> None:
    fs = FakeFirestore()
    store = create_notion_tokens_store(
        firestore=fs,
        oauth_client=_FakeOAuth(),
        now_ms=lambda: 1746522000000,
    )
    await store.set("u1", _tokens())
    doc = await store.get("u1")
    assert doc is not None
    assert doc.botId == "bot-1"
    assert doc.workspaceId == "ws-1"
    assert doc.workspaceName == "Test Notion"


def test_imports_dont_leak_protocol_into_typing() -> None:
    """Sanity: ScopeRequiredError carries the expected `code` literal."""
    err = NotionScopeRequiredError()
    assert err.code == "scope_required"
    # Help mypy realise the imports are used by the helper above.
    _: Any = err
