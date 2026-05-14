"""Smoke tests for the Notion OAuth client. respx mocks Notion's
`/v1/oauth/token` endpoint for both exchange + refresh."""

from __future__ import annotations

import base64

import httpx
import pytest
import respx

from lifecoach_agent.oauth.notion_client import (
    NOTION_TOKEN_URL,
    create_notion_oauth_client,
)


@pytest.mark.asyncio
async def test_exchange_code_returns_tokens_and_workspace_metadata() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(
                200,
                json={
                    "access_token": "AT",
                    "refresh_token": "RT",
                    "expires_in": 3600,
                    "bot_id": "bot-1",
                    "workspace_id": "ws-1",
                    "workspace_name": "Tim's Notion",
                    "owner": {"type": "user", "user": {"id": "u-1"}},
                    "token_type": "bearer",
                },
            )
            client = create_notion_oauth_client(
                client_id="cid",
                client_secret="sec",
                http=http,
                now_ms=lambda: 1746522000000,
            )
            tokens = await client.exchange_code("CODE", "https://tranquil.coach/notion/callback")
            assert tokens.accessToken == "AT"
            assert tokens.refreshToken == "RT"
            assert tokens.botId == "bot-1"
            assert tokens.workspaceId == "ws-1"
            assert tokens.workspaceName == "Tim's Notion"
            assert tokens.owner == {"type": "user", "user": {"id": "u-1"}}


@pytest.mark.asyncio
async def test_exchange_code_sends_basic_auth_header() -> None:
    captured: dict[str, str] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                captured["auth"] = request.headers.get("authorization", "")
                captured["notion_version"] = request.headers.get("notion-version", "")
                return httpx.Response(
                    200,
                    json={
                        "access_token": "AT",
                        "refresh_token": "RT",
                        "expires_in": 3600,
                        "bot_id": "bot-1",
                        "workspace_id": "ws-1",
                        "workspace_name": "Tim's Notion",
                        "owner": {},
                    },
                )

            mock.post(NOTION_TOKEN_URL).mock(side_effect=_handler)
            client = create_notion_oauth_client(
                client_id="cid",
                client_secret="sec",
                http=http,
                now_ms=lambda: 1746522000000,
            )
            await client.exchange_code("CODE", "https://example/callback")

    # Notion uses HTTP Basic auth with base64(client_id:client_secret).
    expected = "Basic " + base64.b64encode(b"cid:sec").decode("ascii")
    assert captured["auth"] == expected
    assert captured["notion_version"] == "2022-06-28"


@pytest.mark.asyncio
async def test_refresh_returns_new_access_token_and_rotated_refresh() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(
                200,
                json={
                    "access_token": "AT2",
                    "refresh_token": "RT2",  # rotated
                    "expires_in": 3600,
                    "token_type": "bearer",
                },
            )
            client = create_notion_oauth_client(
                client_id="cid",
                client_secret="sec",
                http=http,
                now_ms=lambda: 1746522000000,
            )
            result = await client.refresh_access_token("RT")
            assert result.accessToken == "AT2"
            assert result.refreshToken == "RT2"


@pytest.mark.asyncio
async def test_refresh_returns_none_when_notion_doesnt_rotate() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(
                200,
                json={
                    "access_token": "AT2",
                    "expires_in": 3600,
                    "token_type": "bearer",
                },
            )
            client = create_notion_oauth_client(
                client_id="cid",
                client_secret="sec",
                http=http,
                now_ms=lambda: 1746522000000,
            )
            result = await client.refresh_access_token("RT")
            assert result.accessToken == "AT2"
            assert result.refreshToken is None


@pytest.mark.asyncio
async def test_exchange_raises_on_non_200() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(400, text="bad code")
            client = create_notion_oauth_client(client_id="cid", client_secret="sec", http=http)
            with pytest.raises(RuntimeError, match="notion-oauth-exchange"):
                await client.exchange_code("BAD", "https://example/cb")


@pytest.mark.asyncio
async def test_refresh_raises_on_non_200() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(401, text="unauthorized")
            client = create_notion_oauth_client(client_id="cid", client_secret="sec", http=http)
            with pytest.raises(RuntimeError, match="notion-oauth-refresh"):
                await client.refresh_access_token("RT")
