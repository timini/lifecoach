"""Smoke tests for the Notion HTTP dispatcher. respx mocks the
api.notion.com endpoint shapes we hit."""

from __future__ import annotations

import httpx
import pytest
import respx

from lifecoach_agent.notion_agent.notion_client import (
    NOTION_API_BASE,
    NOTION_API_VERSION,
    CallNotionErr,
    CallNotionOk,
    call_notion,
)


def _url(path: str) -> str:
    return f"{NOTION_API_BASE}{path}"


@pytest.mark.asyncio
async def test_get_returns_ok_with_parsed_body() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).respond(200, json={"object": "page", "id": "p1"})
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionOk)
            assert result.body == {"object": "page", "id": "p1"}
            assert result.truncated is False


@pytest.mark.asyncio
async def test_request_sends_bearer_auth_and_notion_version() -> None:
    captured: dict[str, str] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                captured["auth"] = request.headers.get("authorization", "")
                captured["notion_version"] = request.headers.get("notion-version", "")
                return httpx.Response(200, json={"ok": True})

            mock.get(_url("/v1/pages/p1")).mock(side_effect=_handler)
            await call_notion(access_token="AT", method="GET", path="/v1/pages/p1", http=http)

    assert captured["auth"] == "Bearer AT"
    assert captured["notion_version"] == NOTION_API_VERSION


@pytest.mark.asyncio
async def test_post_with_body_sets_json_content_type() -> None:
    captured: dict[str, str] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                captured["content_type"] = request.headers.get("content-type", "")
                return httpx.Response(200, json={"ok": True})

            mock.post(_url("/v1/pages")).mock(side_effect=_handler)
            await call_notion(
                access_token="AT",
                method="POST",
                path="/v1/pages",
                body={"properties": {}},
                http=http,
            )

    assert captured["content_type"] == "application/json"


@pytest.mark.asyncio
async def test_401_maps_to_scope_required() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).respond(
                401, json={"object": "error", "message": "Token is invalid."}
            )
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr)
            assert result.code == "scope_required"
            assert "Token is invalid" in result.message


@pytest.mark.asyncio
async def test_403_maps_to_forbidden() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).respond(403, text="forbidden")
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr) and result.code == "forbidden"


@pytest.mark.asyncio
async def test_404_maps_to_not_found() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).respond(404, json={"message": "Could not find page."})
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr)
            assert result.code == "not_found"
            assert "find page" in result.message


@pytest.mark.asyncio
async def test_429_maps_to_rate_limited() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).respond(429, text="too many")
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr) and result.code == "rate_limited"


@pytest.mark.asyncio
async def test_400_maps_to_bad_request() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(_url("/v1/pages")).respond(400, json={"message": "body failed validation"})
            result = await call_notion(
                access_token="AT", method="POST", path="/v1/pages", body={}, http=http
            )
            assert isinstance(result, CallNotionErr)
            assert result.code == "bad_request"
            assert "validation" in result.message


@pytest.mark.asyncio
async def test_5xx_maps_to_upstream() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).respond(503, text="service unavailable")
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr) and result.code == "upstream"


@pytest.mark.asyncio
async def test_timeout_maps_to_timeout() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).mock(side_effect=httpx.ReadTimeout("slow"))
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr) and result.code == "timeout"


@pytest.mark.asyncio
async def test_network_error_maps_to_network() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).mock(side_effect=httpx.ConnectError("nope"))
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr) and result.code == "network"


@pytest.mark.asyncio
async def test_truncated_flag_set_on_large_bodies() -> None:
    """A 33 KB payload should come back with `truncated=True` so the
    calling tool can warn the user instead of streaming it whole."""
    big = {"items": ["x" * 100 for _ in range(400)]}  # ~40 KB JSON
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/databases/db/query")).respond(200, json=big)
            result = await call_notion(
                access_token="AT",
                method="GET",
                path="/v1/databases/db/query",
                http=http,
            )
            assert isinstance(result, CallNotionOk)
            assert result.truncated is True


@pytest.mark.asyncio
async def test_non_json_response_maps_to_upstream() -> None:
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_url("/v1/pages/p1")).respond(200, text="<html>nope</html>")
            result = await call_notion(
                access_token="AT", method="GET", path="/v1/pages/p1", http=http
            )
            assert isinstance(result, CallNotionErr) and result.code == "upstream"
