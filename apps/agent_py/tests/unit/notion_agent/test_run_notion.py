"""Tests for the `run_notion` helper — verifies token resolution,
scope_required doc-delete, log hook fires correctly."""

from __future__ import annotations

import httpx
import pytest
import respx

from lifecoach_agent.notion_agent.notion_client import NOTION_API_BASE
from lifecoach_agent.notion_agent.run_notion import (
    RunNotionErr,
    RunNotionLogEvent,
    RunNotionOk,
    run_notion,
)
from lifecoach_agent.oauth.notion_client import NotionRefreshResult, NotionTokens
from lifecoach_agent.storage.notion_tokens import create_notion_tokens_store
from tests.unit.storage._fakes import FakeFirestore


class _FakeOAuth:
    def __init__(self, *, raises: bool = False) -> None:
        self.raises = raises

    async def exchange_code(self, code: str, redirect_uri: str) -> NotionTokens:
        raise NotImplementedError

    async def refresh_access_token(self, refresh_token: str) -> NotionRefreshResult:
        if self.raises:
            raise RuntimeError("revoked")
        return NotionRefreshResult(
            accessToken="AT2",
            accessTokenExpiresAt="2099-01-01T00:00:00.000Z",
            refreshToken=None,
        )


def _seed_token(
    fs: FakeFirestore, uid: str = "u1", expires: str = "2099-01-01T00:00:00.000Z"
) -> None:
    fs.docs[f"notionTokens/{uid}"] = {
        "uid": uid,
        "accessToken": "AT",
        "accessTokenExpiresAt": expires,
        "refreshToken": "RT",
        "botId": "bot-1",
        "workspaceId": "ws-1",
        "workspaceName": "Test",
        "grantedAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-05-01T00:00:00.000Z",
    }


@pytest.mark.asyncio
async def test_ok_path_returns_body_and_fires_log() -> None:
    fs = FakeFirestore()
    _seed_token(fs)
    store = create_notion_tokens_store(
        firestore=fs, oauth_client=_FakeOAuth(), now_ms=lambda: 1746522000000
    )
    events: list[RunNotionLogEvent] = []
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(f"{NOTION_API_BASE}/v1/pages/p1").respond(200, json={"id": "p1"})
            result = await run_notion(
                store=store,
                uid="u1",
                tool_name="get_task",
                method="GET",
                path="/v1/pages/p1",
                http=http,
                log=events.append,
            )

    assert isinstance(result, RunNotionOk)
    assert result.body == {"id": "p1"}
    assert events == [
        RunNotionLogEvent(name="get_task", method="GET", path="/v1/pages/p1", outcome="ok")
    ]


@pytest.mark.asyncio
async def test_scope_required_from_token_store_deletes_doc_and_returns_err() -> None:
    fs = FakeFirestore()
    # No doc seeded → token store raises NotionScopeRequiredError.
    store = create_notion_tokens_store(
        firestore=fs, oauth_client=_FakeOAuth(), now_ms=lambda: 1746522000000
    )
    events: list[RunNotionLogEvent] = []
    result = await run_notion(
        store=store,
        uid="u1",
        tool_name="get_task",
        method="GET",
        path="/v1/pages/p1",
        log=events.append,
    )
    assert isinstance(result, RunNotionErr) and result.code == "scope_required"
    assert events[0].outcome == "scope_required"


@pytest.mark.asyncio
async def test_401_from_notion_deletes_doc_and_returns_scope_required() -> None:
    """Token-store happily handed back AT, but Notion 401s — meaning
    the integration was killed at the user's end after our last
    refresh succeeded. We must delete the doc so the next chat turn
    sees notion_connected=False."""
    fs = FakeFirestore()
    _seed_token(fs)
    store = create_notion_tokens_store(
        firestore=fs, oauth_client=_FakeOAuth(), now_ms=lambda: 1746522000000
    )
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(f"{NOTION_API_BASE}/v1/pages/p1").respond(
                401, json={"message": "API token is invalid"}
            )
            result = await run_notion(
                store=store,
                uid="u1",
                tool_name="get_task",
                method="GET",
                path="/v1/pages/p1",
                http=http,
            )

    assert isinstance(result, RunNotionErr) and result.code == "scope_required"
    assert await store.get("u1") is None


@pytest.mark.asyncio
async def test_404_from_notion_does_not_delete_doc() -> None:
    fs = FakeFirestore()
    _seed_token(fs)
    store = create_notion_tokens_store(
        firestore=fs, oauth_client=_FakeOAuth(), now_ms=lambda: 1746522000000
    )
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(f"{NOTION_API_BASE}/v1/pages/p1").respond(404, json={"message": "Not found"})
            result = await run_notion(
                store=store,
                uid="u1",
                tool_name="get_task",
                method="GET",
                path="/v1/pages/p1",
                http=http,
            )

    assert isinstance(result, RunNotionErr) and result.code == "not_found"
    assert await store.get("u1") is not None  # auth doc preserved


@pytest.mark.asyncio
async def test_body_is_forwarded_to_call_notion() -> None:
    fs = FakeFirestore()
    _seed_token(fs)
    store = create_notion_tokens_store(
        firestore=fs, oauth_client=_FakeOAuth(), now_ms=lambda: 1746522000000
    )

    received: dict[str, bytes] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                received["content"] = request.content
                return httpx.Response(200, json={"object": "page"})

            mock.post(f"{NOTION_API_BASE}/v1/pages").mock(side_effect=_handler)
            await run_notion(
                store=store,
                uid="u1",
                tool_name="add_task",
                method="POST",
                path="/v1/pages",
                body={"properties": {"Task": "Test"}},
                http=http,
            )

    assert b'"Task":"Test"' in received["content"]
