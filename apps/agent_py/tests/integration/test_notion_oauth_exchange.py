"""Integration coverage for the Notion OAuth code-for-tokens exchange.

Drives the real FastAPI server (via httpx.ASGITransport — no uvicorn)
against a fake Notion `/v1/oauth/token` endpoint (respx). Verifies that:

  1. POST /notion/oauth-exchange forwards the code + redirect_uri to
     Notion using HTTP Basic auth, persists the resulting tokens +
     workspace metadata, seeds the notionConfig doc, and returns the
     redacted status payload (no token material echoed).
  2. GET /notion/status reflects the persisted doc on the next call.
  3. DELETE /notion removes both the tokens AND config docs.
  4. Auth-missing / config-missing / Notion-error fall through to the
     documented status codes (401 / 503 / 400).

This is the only test that wires the real server + real stores + real
OAuth client together — every other Notion test mocks at least one
layer. It's the regression net for the boundary between web → agent.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
import respx

from lifecoach_agent.auth import VerifiedClaims
from lifecoach_agent.oauth.notion_client import NOTION_TOKEN_URL, create_notion_oauth_client
from lifecoach_agent.server import CreateAppDeps, RunnerForParams, create_app
from lifecoach_agent.storage.notion_config import create_notion_config_store
from lifecoach_agent.storage.notion_tokens import create_notion_tokens_store
from tests.unit.storage._fakes import FakeFirestore


def _model_text(text: str) -> dict[str, Any]:
    return {
        "author": "lifecoach",
        "content": {"role": "model", "parts": [{"text": text}]},
    }


class _NoopRunner:
    """Used as a stub for `runner_for` — the /chat path isn't exercised
    here. The dep is required by CreateAppDeps but unused for /notion/*
    routes."""

    async def run_async(self, *_a: Any, **_kw: Any) -> AsyncIterator[dict[str, Any]]:
        yield _model_text("hi")


def _make_app(http: httpx.AsyncClient) -> tuple[Any, Any, Any]:
    """Wires the real notion OAuth client + token store + config store
    against a shared FakeFirestore. Returns (app, tokens_store,
    config_store) so the test can assert persisted state directly."""

    fs = FakeFirestore()
    oauth = create_notion_oauth_client(
        client_id="cid",
        client_secret="sec",
        http=http,
    )
    tokens_store = create_notion_tokens_store(firestore=fs, oauth_client=oauth)
    config_store = create_notion_config_store(firestore=fs)

    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1")

    def runner_for(_params: RunnerForParams) -> Any:
        return _NoopRunner()

    deps = CreateAppDeps(
        runner_for=runner_for,
        now=lambda: datetime(2026, 5, 14, 9, 0, tzinfo=ZoneInfo("UTC")),
        notion_oauth_client=oauth,
        notion_tokens_store=tokens_store,
        notion_config_store=config_store,
        verify_token=_verifier,
    )
    return create_app(deps), tokens_store, config_store


def _client(app: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# --- /notion/oauth-exchange ---------------------------------------------


@pytest.mark.asyncio
async def test_oauth_exchange_persists_tokens_and_seeds_config() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(
                200,
                json={
                    "access_token": "ntn_AT",
                    "refresh_token": "ntn_RT",
                    "expires_in": 3600,
                    "bot_id": "bot-1",
                    "workspace_id": "ws-1",
                    "workspace_name": "Tim's Notion",
                    "owner": {"type": "user", "user": {"id": "u-1"}},
                    "token_type": "bearer",
                },
            )
            app, tokens_store, config_store = _make_app(http)
            async with _client(app) as c:
                res = await c.post(
                    "/notion/oauth-exchange",
                    json={
                        "code": "AUTH-CODE",
                        "redirect_uri": "https://tranquil.coach/notion/callback",
                    },
                    headers={"Authorization": "Bearer x"},
                )

            assert res.status_code == 200, res.text
            body = res.json()
            assert body["connected"] is True
            assert body["workspaceName"] == "Tim's Notion"
            assert body["grantedAt"] is not None
            # Critical: NO access/refresh tokens or codes leak into the
            # response body — only the redacted status surface.
            assert "ntn_AT" not in res.text
            assert "ntn_RT" not in res.text
            assert "AUTH-CODE" not in res.text

            # Tokens persisted.
            saved = await tokens_store.get("u1")
            assert saved is not None
            assert saved.accessToken == "ntn_AT"
            assert saved.refreshToken == "ntn_RT"
            assert saved.workspaceId == "ws-1"
            assert saved.workspaceName == "Tim's Notion"

            # Config doc seeded (empty parent pages — bootstrap searches
            # on first tool call). databaseId starts unset.
            cfg = await config_store.get("u1")
            assert cfg is not None
            assert cfg.workspaceId == "ws-1"
            assert cfg.databaseId is None


@pytest.mark.asyncio
async def test_oauth_exchange_returns_400_when_code_missing() -> None:
    async with httpx.AsyncClient() as http:
        app, _t, _c = _make_app(http)
        async with _client(app) as c:
            res = await c.post(
                "/notion/oauth-exchange",
                json={"redirect_uri": "https://tranquil.coach/notion/callback"},
                headers={"Authorization": "Bearer x"},
            )
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_oauth_exchange_returns_400_when_redirect_uri_missing() -> None:
    async with httpx.AsyncClient() as http:
        app, _t, _c = _make_app(http)
        async with _client(app) as c:
            res = await c.post(
                "/notion/oauth-exchange",
                json={"code": "x"},
                headers={"Authorization": "Bearer x"},
            )
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_oauth_exchange_requires_auth() -> None:
    async with httpx.AsyncClient() as http:
        app, _t, _c = _make_app(http)
        async with _client(app) as c:
            res = await c.post(
                "/notion/oauth-exchange",
                json={
                    "code": "x",
                    "redirect_uri": "https://tranquil.coach/notion/callback",
                },
            )
        assert res.status_code == 401


@pytest.mark.asyncio
async def test_oauth_exchange_400_on_notion_failure_without_leaking_code() -> None:
    """When Notion returns 400 the agent must:
    - respond with {"error": "oauth_exchange_failed"} status=400
    - NOT echo the raw upstream body (which could include the code or
      a token fragment)."""

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(
                400,
                json={"error": "invalid_grant", "error_description": "stale code SECRET-LEAK"},
            )
            app, _t, _c = _make_app(http)
            async with _client(app) as c:
                res = await c.post(
                    "/notion/oauth-exchange",
                    json={
                        "code": "STALE-CODE",
                        "redirect_uri": "https://tranquil.coach/notion/callback",
                    },
                    headers={"Authorization": "Bearer x"},
                )
            assert res.status_code == 400
            assert res.json() == {"error": "oauth_exchange_failed"}
            assert "STALE-CODE" not in res.text
            assert "SECRET-LEAK" not in res.text


@pytest.mark.asyncio
async def test_oauth_exchange_returns_503_when_notion_not_configured() -> None:
    """When the deployment didn't ship NOTION_OAUTH_CLIENT_ID/SECRET,
    deps.notion_* are None and the route must surface that distinctly
    from a real Notion failure."""

    async def _verifier(_token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1")

    def runner_for(_params: RunnerForParams) -> Any:
        return _NoopRunner()

    deps = CreateAppDeps(
        runner_for=runner_for,
        now=lambda: datetime(2026, 5, 14, 9, 0, tzinfo=ZoneInfo("UTC")),
        verify_token=_verifier,
        # Critical: no notion_* deps wired.
    )
    app = create_app(deps)
    async with _client(app) as c:
        res = await c.post(
            "/notion/oauth-exchange",
            json={
                "code": "x",
                "redirect_uri": "https://tranquil.coach/notion/callback",
            },
            headers={"Authorization": "Bearer x"},
        )
    assert res.status_code == 503


# --- /notion/status follow-up ------------------------------------------


@pytest.mark.asyncio
async def test_status_reflects_persisted_token_after_exchange() -> None:
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
                    "workspace_name": "Sandbox",
                    "owner": {},
                    "token_type": "bearer",
                },
            )
            app, _t, _c = _make_app(http)
            async with _client(app) as c:
                await c.post(
                    "/notion/oauth-exchange",
                    json={
                        "code": "C",
                        "redirect_uri": "https://tranquil.coach/notion/callback",
                    },
                    headers={"Authorization": "Bearer x"},
                )
                res = await c.get(
                    "/notion/status",
                    headers={"Authorization": "Bearer x"},
                )
            assert res.status_code == 200
            body = res.json()
            assert body["connected"] is True
            assert body["workspaceName"] == "Sandbox"


# --- DELETE /notion ----------------------------------------------------


@pytest.mark.asyncio
async def test_delete_clears_both_tokens_and_config_docs() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(NOTION_TOKEN_URL).respond(
                200,
                json={
                    "access_token": "AT",
                    "refresh_token": "RT",
                    "expires_in": 3600,
                    "bot_id": "b",
                    "workspace_id": "ws",
                    "workspace_name": "W",
                    "owner": {},
                    "token_type": "bearer",
                },
            )
            app, tokens_store, config_store = _make_app(http)
            async with _client(app) as c:
                await c.post(
                    "/notion/oauth-exchange",
                    json={"code": "C", "redirect_uri": "https://tranquil.coach/notion/callback"},
                    headers={"Authorization": "Bearer x"},
                )
                # Pre-condition: both docs exist.
                assert await tokens_store.get("u1") is not None
                assert await config_store.get("u1") is not None

                res = await c.delete("/notion", headers={"Authorization": "Bearer x"})
            assert res.status_code == 200
            assert res.json()["connected"] is False
            # Both docs gone.
            assert await tokens_store.get("u1") is None
            assert await config_store.get("u1") is None
