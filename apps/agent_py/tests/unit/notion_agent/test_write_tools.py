"""Tests for the four Notion write tools: add / update / set_parent /
complete. respx mocks the Notion REST API."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

from lifecoach_agent.notion_agent.notion_client import NOTION_API_BASE
from lifecoach_agent.notion_agent.tools.add_notion_task import create_add_notion_task_tool
from lifecoach_agent.notion_agent.tools.complete_notion_task import (
    create_complete_notion_task_tool,
)
from lifecoach_agent.notion_agent.tools.set_notion_task_parent import (
    create_set_notion_task_parent_tool,
)
from lifecoach_agent.notion_agent.tools.update_notion_task import (
    create_update_notion_task_tool,
)
from tests.unit.notion_agent._helpers import (
    make_deps,
    page_obj,
    seed_config,
    seed_token,
)
from tests.unit.storage._fakes import FakeFirestore


async def _invoke(tool: Any, **kwargs: Any) -> Any:
    return await tool.func(**kwargs)


def _make_setup() -> tuple[FakeFirestore, Any]:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-1")
    return fs, None  # http added by caller


# --- add_notion_task ---


@pytest.mark.asyncio
async def test_add_notion_task_posts_with_minimum_properties() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p-new", title="ship it"))

            mock.post(f"{NOTION_API_BASE}/v1/pages").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_add_notion_task_tool(deps)
            out = await _invoke(tool, title="ship it")

    assert out["status"] == "ok"
    assert out["task"]["title"] == "ship it"
    # Status defaults to To Do; parented to the auto-bootstrapped DB.
    assert sent["parent"] == {"database_id": "db-1"}
    assert sent["properties"]["Task"]["title"][0]["text"]["content"] == "ship it"
    assert sent["properties"]["Status"]["select"]["name"] == "To Do"
    # Optional fields omitted when not supplied.
    assert "Priority" not in sent["properties"]
    assert "Project" not in sent["properties"]
    assert "Parent item" not in sent["properties"]


@pytest.mark.asyncio
async def test_add_notion_task_includes_all_optional_properties() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p-new"))

            mock.post(f"{NOTION_API_BASE}/v1/pages").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_add_notion_task_tool(deps)
            await _invoke(
                tool,
                title="auth fix",
                project="Apollo",
                priority="High",
                due="2026-05-30",
                parent_id="parent-1",
                notes="initial plan",
            )

    props = sent["properties"]
    assert props["Priority"]["select"]["name"] == "High"
    assert props["Project"]["select"]["name"] == "Apollo"
    assert props["Due Date"]["date"]["start"] == "2026-05-30"
    assert props["Parent item"]["relation"][0]["id"] == "parent-1"
    assert props["Notes"]["rich_text"][0]["text"]["content"] == "initial plan"


@pytest.mark.asyncio
async def test_add_notion_task_rejects_empty_title() -> None:
    fs, _ = _make_setup()
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        tool = create_add_notion_task_tool(deps)
        out = await _invoke(tool, title="")
    assert out == {"status": "error", "code": "bad_request", "message": "title required"}


# --- update_notion_task ---


@pytest.mark.asyncio
async def test_update_notion_task_refuses_status_done() -> None:
    fs, _ = _make_setup()
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        tool = create_update_notion_task_tool(deps)
        out = await _invoke(tool, id="p1", status="Done")
    assert out["status"] == "error"
    assert out["code"] == "bad_request"
    assert "complete_notion_task" in out["message"]


@pytest.mark.asyncio
async def test_update_notion_task_status_in_progress_patches() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1", status="In Progress"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_update_notion_task_tool(deps)
            out = await _invoke(tool, id="p1", status="In Progress")

    assert out["status"] == "ok"
    assert sent["properties"]["Status"]["select"]["name"] == "In Progress"


@pytest.mark.asyncio
async def test_update_notion_task_append_mode_prepends_existing_notes() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            # Existing notes fetch
            existing = page_obj(id="p1")
            existing["properties"]["Notes"] = {"rich_text": [{"plain_text": "previous decision"}]}
            mock.get(f"{NOTION_API_BASE}/v1/pages/p1").respond(200, json=existing)

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_update_notion_task_tool(deps)
            await _invoke(tool, id="p1", notes="now picking OIDC over OAuth")

    notes_text = sent["properties"]["Notes"]["rich_text"][0]["text"]["content"]
    assert "previous decision" in notes_text
    assert "now picking OIDC over OAuth" in notes_text
    # Order: previous first, then new.
    assert notes_text.index("previous decision") < notes_text.index("now picking OIDC")


@pytest.mark.asyncio
async def test_update_notion_task_replace_mode_overwrites_notes() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_update_notion_task_tool(deps)
            await _invoke(tool, id="p1", notes="fresh content", notes_mode="replace")

    notes_text = sent["properties"]["Notes"]["rich_text"][0]["text"]["content"]
    assert notes_text == "fresh content"


@pytest.mark.asyncio
async def test_update_notion_task_rejects_when_nothing_supplied() -> None:
    fs, _ = _make_setup()
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        tool = create_update_notion_task_tool(deps)
        out = await _invoke(tool, id="p1")
    assert out["status"] == "error"
    assert out["code"] == "bad_request"
    assert "nothing to update" in out["message"]


# --- set_notion_task_parent ---


@pytest.mark.asyncio
async def test_set_parent_patches_relation_id() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_set_notion_task_parent_tool(deps)
            await _invoke(tool, id="p1", parent_id="parent-x")

    assert sent["properties"]["Parent item"]["relation"] == [{"id": "parent-x"}]


@pytest.mark.asyncio
async def test_set_parent_clears_relation_when_parent_id_none() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_set_notion_task_parent_tool(deps)
            await _invoke(tool, id="p1", parent_id=None)

    assert sent["properties"]["Parent item"]["relation"] == []


# --- complete_notion_task ---


@pytest.mark.asyncio
async def test_complete_notion_task_patches_status_done() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1", status="Done"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_complete_notion_task_tool(deps)
            out = await _invoke(tool, id="p1")

    assert out["status"] == "ok"
    assert sent["properties"]["Status"]["select"]["name"] == "Done"
    assert "Notes" not in sent["properties"]


@pytest.mark.asyncio
async def test_complete_notion_task_appends_completion_note_to_notes() -> None:
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            existing = page_obj(id="p1")
            existing["properties"]["Notes"] = {"rich_text": [{"plain_text": "in progress notes"}]}
            mock.get(f"{NOTION_API_BASE}/v1/pages/p1").respond(200, json=existing)

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1", status="Done"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_complete_notion_task_tool(deps)
            await _invoke(tool, id="p1", completion_note="shipped Friday")

    notes_text = sent["properties"]["Notes"]["rich_text"][0]["text"]["content"]
    assert "in progress notes" in notes_text
    assert "Completed: shipped Friday" in notes_text


@pytest.mark.asyncio
async def test_update_notion_task_empty_string_fields_are_noop() -> None:
    """Empty-string field values must NOT clear the property — they're
    treated as 'no change' (consistent with title), so an all-empty call
    is a no-op and errors rather than silently wiping data."""
    fs, _ = _make_setup()
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            patched = mock.patch(f"{NOTION_API_BASE}/v1/pages/p1")
            deps = make_deps(fs, http)
            tool = create_update_notion_task_tool(deps)
            out = await _invoke(tool, id="p1", priority="", project="", due="", title="")

    assert out["status"] == "error"
    assert out["code"] == "bad_request"
    assert not patched.called


@pytest.mark.asyncio
async def test_update_notion_task_chunks_notes_over_2000_chars() -> None:
    """Notion rejects a rich_text element over 2000 chars; long notes are
    split across multiple elements so the write doesn't 400."""
    fs, _ = _make_setup()
    sent: dict[str, Any] = {}
    long_notes = "x" * 2500

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                sent.update(json.loads(request.content))
                return httpx.Response(200, json=page_obj(id="p1"))

            mock.patch(f"{NOTION_API_BASE}/v1/pages/p1").mock(side_effect=_handler)
            deps = make_deps(fs, http)
            tool = create_update_notion_task_tool(deps)
            out = await _invoke(tool, id="p1", notes=long_notes, notes_mode="replace")

    assert out["status"] == "ok"
    elements = sent["properties"]["Notes"]["rich_text"]
    assert len(elements) == 2
    assert all(len(e["text"]["content"]) <= 2000 for e in elements)
    assert "".join(e["text"]["content"] for e in elements) == long_notes
