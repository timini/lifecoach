"""Smoke tests for the Workspace OAuth client. Uses respx to mock
Google's token + revoke endpoints."""

from __future__ import annotations

import httpx
import pytest
import respx

from lifecoach_agent.oauth.workspace_client import (
    GOOGLE_REVOKE_URL,
    GOOGLE_TOKEN_URL,
    create_workspace_oauth_client,
)


@pytest.mark.asyncio
async def test_exchange_code_returns_tokens() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(GOOGLE_TOKEN_URL).respond(
                200,
                json={
                    "access_token": "AT",
                    "refresh_token": "RT",
                    "expires_in": 3600,
                    "scope": "https://mail.google.com/ https://www.googleapis.com/auth/calendar",
                    "token_type": "Bearer",
                },
            )
            client = create_workspace_oauth_client(
                client_id="cid",
                client_secret="sec",
                http=http,
                now_ms=lambda: 1746522000000,
            )
            tokens = await client.exchange_code("CODE")
            assert tokens.accessToken == "AT"
            assert tokens.refreshToken == "RT"
            assert tokens.scopes == [
                "https://mail.google.com/",
                "https://www.googleapis.com/auth/calendar",
            ]


@pytest.mark.asyncio
async def test_refresh_returns_new_access_token() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(GOOGLE_TOKEN_URL).respond(
                200,
                json={
                    "access_token": "AT2",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                },
            )
            client = create_workspace_oauth_client(
                client_id="cid",
                client_secret="sec",
                http=http,
                now_ms=lambda: 1746522000000,
            )
            result = await client.refresh_access_token("RT")
            assert result.accessToken == "AT2"
            assert result.refreshToken is None  # Google didn't rotate


@pytest.mark.asyncio
async def test_refresh_raises_on_non_200() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(GOOGLE_TOKEN_URL).respond(400, text="bad")
            client = create_workspace_oauth_client(client_id="cid", client_secret="sec", http=http)
            with pytest.raises(RuntimeError, match="oauth-refresh"):
                await client.refresh_access_token("RT")


@pytest.mark.asyncio
async def test_revoke_swallows_errors() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(GOOGLE_REVOKE_URL).respond(500, text="error")
            client = create_workspace_oauth_client(client_id="cid", client_secret="sec", http=http)
            await client.revoke_refresh_token("RT")  # no exception → pass
