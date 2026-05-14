"""Tests for the sub-agent's internal Notion read tools: list_tasks,
get_task, search_tasks."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from lifecoach_agent.notion_agent.notion_client import NOTION_API_BASE
from lifecoach_agent.notion_agent.tools.internal import (
    create_get_task_tool,
    create_list_tasks_tool,
    create_search_tasks_tool,
)
from tests.unit.notion_agent._helpers import (
    make_deps,
    page_obj,
    seed_config,
    seed_token,
)
from tests.unit.storage._fakes import FakeFirestore


async def _invoke(tool: Any, **kwargs: Any) -> Any:
    """ADK's FunctionTool wraps a callable; pull it out so the tests
    drive the underlying coroutine directly."""
    return await tool.func(**kwargs)


# --- list_tasks ---


@pytest.mark.asyncio
async def test_list_tasks_returns_open_status_filter_by_default() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-1")

    sent_body: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                import json as _json

                sent_body.update(_json.loads(request.content))
                return httpx.Response(
                    200,
                    json={
                        "results": [page_obj(id="p1", title="ship the auth fix")],
                        "has_more": False,
                    },
                )

            mock.post(f"{NOTION_API_BASE}/v1/databases/db-1/query").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_list_tasks_tool(deps)
            out = await _invoke(tool)

    assert out["status"] == "ok"
    assert len(out["tasks"]) == 1
    assert out["tasks"][0]["title"] == "ship the auth fix"
    assert out["hasMore"] is False
    # The default "open" status maps to the three non-Done statuses.
    or_clause = sent_body["filter"]["or"]
    names = sorted(c["select"]["equals"] for c in or_clause)
    assert names == ["In Progress", "To Do", "Waiting"]


@pytest.mark.asyncio
async def test_list_tasks_all_status_drops_filter() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-1")

    sent_body: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                import json as _json

                sent_body.update(_json.loads(request.content))
                return httpx.Response(200, json={"results": [], "has_more": False})

            mock.post(f"{NOTION_API_BASE}/v1/databases/db-1/query").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_list_tasks_tool(deps)
            out = await _invoke(tool, status="all")

    assert out["status"] == "ok"
    # `status="all"` omits the filter entirely.
    assert "filter" not in sent_body


@pytest.mark.asyncio
async def test_list_tasks_propagates_scope_required() -> None:
    fs = FakeFirestore()
    # No token doc seeded → scope_required from the token store.
    seed_config(fs, database_id="db-1")
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        tool = create_list_tasks_tool(deps)
        out = await _invoke(tool)
    assert out["status"] == "error"
    assert out["code"] == "scope_required"


@pytest.mark.asyncio
async def test_list_tasks_clears_database_id_on_404() -> None:
    """If the stored databaseId no longer resolves, drop it from the
    config doc so the next call re-bootstraps."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-stale")
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(f"{NOTION_API_BASE}/v1/databases/db-stale/query").respond(
                404, json={"message": "Could not find database"}
            )
            deps = make_deps(fs, http)
            tool = create_list_tasks_tool(deps)
            out = await _invoke(tool)
    assert out["status"] == "error" and out["code"] == "not_found"
    cfg = await deps.config_store.get("u1")
    assert cfg is not None and cfg.databaseId is None


# --- get_task ---


@pytest.mark.asyncio
async def test_get_task_returns_flat_projection() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-1")
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.get(f"{NOTION_API_BASE}/v1/pages/p1").respond(
                200, json=page_obj(id="p1", title="hello")
            )
            deps = make_deps(fs, http)
            tool = create_get_task_tool(deps)
            out = await _invoke(tool, id="p1")
    assert out["status"] == "ok"
    assert out["task"]["id"] == "p1"
    assert out["task"]["title"] == "hello"


@pytest.mark.asyncio
async def test_get_task_rejects_empty_id() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        tool = create_get_task_tool(deps)
        out = await _invoke(tool, id="")
    assert out == {"status": "error", "code": "bad_request", "message": "id required"}


# --- search_tasks ---


@pytest.mark.asyncio
async def test_search_tasks_sends_title_and_notes_filter() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-1")

    sent_body: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                import json as _json

                sent_body.update(_json.loads(request.content))
                return httpx.Response(
                    200, json={"results": [page_obj(id="p1", title="auth fix")], "has_more": False}
                )

            mock.post(f"{NOTION_API_BASE}/v1/databases/db-1/query").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_search_tasks_tool(deps)
            out = await _invoke(tool, query="auth")

    assert out["status"] == "ok"
    or_clause = sent_body["filter"]["or"]
    properties = sorted(c["property"] for c in or_clause)
    assert properties == ["Notes", "Task"]
    assert all(c.get("title", c.get("rich_text"))["contains"] == "auth" for c in or_clause)


@pytest.mark.asyncio
async def test_search_tasks_rejects_empty_query() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        tool = create_search_tasks_tool(deps)
        out = await _invoke(tool, query="")
    assert out == {"status": "error", "code": "bad_request", "message": "query required"}
