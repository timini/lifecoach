"""Tests for the per-uid Notion DB bootstrap."""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from lifecoach_agent.notion_agent.database_bootstrap import (
    DatabaseUnavailableError,
    clear_database_id_on_not_found,
    get_or_create_database,
)
from lifecoach_agent.notion_agent.notion_client import NOTION_API_BASE
from tests.unit.notion_agent._helpers import (
    make_deps,
    seed_config,
    seed_token,
)
from tests.unit.storage._fakes import FakeFirestore


@pytest.mark.asyncio
async def test_returns_cached_database_id_when_present() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-existing")
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        db_id = await get_or_create_database(deps)
    assert db_id == "db-existing"


@pytest.mark.asyncio
async def test_creates_database_under_first_granted_page() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id=None, granted_parent_pages=["page-a"])

    create_body: dict[str, object] = {}
    patch_body: dict[str, object] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _create_handler(request: httpx.Request) -> httpx.Response:
                import json as _json

                create_body.update(_json.loads(request.content))
                return httpx.Response(200, json={"id": "db-new"})

            def _patch_handler(request: httpx.Request) -> httpx.Response:
                import json as _json

                patch_body.update(_json.loads(request.content))
                return httpx.Response(200, json={"id": "db-new"})

            mock.post(f"{NOTION_API_BASE}/v1/databases").mock(side_effect=_create_handler)
            mock.patch(f"{NOTION_API_BASE}/v1/databases/db-new").mock(side_effect=_patch_handler)
            deps = make_deps(fs, http)
            db_id = await get_or_create_database(deps)

    assert db_id == "db-new"
    # The bootstrap targeted the first granted parent page.
    assert create_body["parent"] == {"type": "page_id", "page_id": "page-a"}
    # The initial CREATE does NOT include Parent item — that would
    # require the new DB's id, which we don't have yet (Notion has no
    # `__SELF__` sentinel; sending one fails with 400).
    create_props = create_body.get("properties") or {}
    assert isinstance(create_props, dict)
    assert "Parent item" not in create_props
    # A follow-up PATCH adds Parent item as a self-relation pointing
    # at the just-created database id.
    patch_props = patch_body.get("properties") or {}
    assert isinstance(patch_props, dict)
    parent_relation = patch_props.get("Parent item")
    assert isinstance(parent_relation, dict)
    rel = parent_relation.get("relation")
    assert isinstance(rel, dict)
    assert rel.get("database_id") == "db-new"
    assert rel.get("type") == "single_property"
    # And persisted the new id on the config doc.
    cfg = await deps.config_store.get("u1")
    assert cfg is not None and cfg.databaseId == "db-new"


@pytest.mark.asyncio
async def test_raises_when_no_config_doc_present() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    # No config seeded.
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        with pytest.raises(DatabaseUnavailableError) as ei:
            await get_or_create_database(deps)
    assert ei.value.code == "scope_required"


@pytest.mark.asyncio
async def test_raises_when_search_finds_no_pages() -> None:
    """Search-fallback runs, returns no results — surface the
    bad_request asking the user to share a page with the integration."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id=None, granted_parent_pages=[])
    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(f"{NOTION_API_BASE}/v1/search").respond(200, json={"results": []})
            deps = make_deps(fs, http)
            with pytest.raises(DatabaseUnavailableError) as ei:
                await get_or_create_database(deps)
    assert ei.value.code == "bad_request"


@pytest.mark.asyncio
async def test_discovers_granted_parent_pages_via_search_when_empty() -> None:
    """When the OAuth handler persisted an empty grantedParentPageIds,
    the bootstrap discovers pages via /v1/search, persists them, and
    proceeds with the first hit."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id=None, granted_parent_pages=[])

    create_body: dict[str, object] = {}

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(f"{NOTION_API_BASE}/v1/search").respond(
                200,
                json={
                    "results": [
                        # Mixed shapes — search returns pages AND
                        # databases; we only want pages we can parent under.
                        {"object": "database", "id": "db-1"},
                        {"object": "page", "id": "page-discovered-1"},
                        {"object": "page", "id": "page-discovered-2"},
                    ]
                },
            )

            def _create_handler(request: httpx.Request) -> httpx.Response:
                import json as _json

                create_body.update(_json.loads(request.content))
                return httpx.Response(200, json={"id": "db-new"})

            mock.post(f"{NOTION_API_BASE}/v1/databases").mock(side_effect=_create_handler)
            mock.patch(f"{NOTION_API_BASE}/v1/databases/db-new").respond(200, json={"id": "db-new"})
            deps = make_deps(fs, http)
            db_id = await get_or_create_database(deps)

    assert db_id == "db-new"
    # Created under the first discovered page.
    assert create_body["parent"] == {"type": "page_id", "page_id": "page-discovered-1"}
    # And the discovered ids were persisted back onto the config doc
    # (so a subsequent bootstrap doesn't re-search).
    cfg = await deps.config_store.get("u1")
    assert cfg is not None
    assert cfg.grantedParentPageIds == ["page-discovered-1", "page-discovered-2"]


@pytest.mark.asyncio
async def test_search_fallback_when_create_returns_bad_request() -> None:
    """A 400 from create-database triggers a search-by-title fallback
    (e.g. a previous bootstrap that we lost state on)."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id=None, granted_parent_pages=["page-a"])

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(f"{NOTION_API_BASE}/v1/databases").respond(400, json={"message": "duplicate"})
            mock.post(f"{NOTION_API_BASE}/v1/search").respond(
                200,
                json={
                    "results": [
                        {
                            "object": "database",
                            "id": "db-found",
                            "title": [{"plain_text": "Lifecoach Tasks"}],
                            "parent": {"page_id": "page-a"},
                        }
                    ]
                },
            )
            deps = make_deps(fs, http)
            db_id = await get_or_create_database(deps)

    assert db_id == "db-found"
    cfg = await deps.config_store.get("u1")
    assert cfg is not None and cfg.databaseId == "db-found"


@pytest.mark.asyncio
async def test_create_raises_when_parent_item_patch_fails() -> None:
    """If the follow-up PATCH that adds the Parent item self-relation
    fails, surface the error and do NOT persist the half-bootstrapped
    databaseId — the next call will re-attempt both steps."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id=None, granted_parent_pages=["page-a"])

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:
            mock.post(f"{NOTION_API_BASE}/v1/databases").respond(200, json={"id": "db-new"})
            mock.patch(f"{NOTION_API_BASE}/v1/databases/db-new").respond(
                400, json={"message": "bad property"}
            )
            deps = make_deps(fs, http)
            with pytest.raises(DatabaseUnavailableError):
                await get_or_create_database(deps)

    # No persisted db id — bootstrap is atomic across both steps.
    cfg = await deps.config_store.get("u1")
    assert cfg is not None and cfg.databaseId is None


@pytest.mark.asyncio
async def test_per_uid_lock_serializes_concurrent_bootstraps() -> None:
    """Two callers racing the first bootstrap collapse onto one
    create. The lock keeps Notion from getting two POSTs (which would
    create two duplicate DBs)."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id=None, granted_parent_pages=["page-a"])

    call_count = 0

    async with httpx.AsyncClient() as http:
        with respx.mock(assert_all_called=False) as mock:

            def _handler(_request: httpx.Request) -> httpx.Response:
                nonlocal call_count
                call_count += 1
                return httpx.Response(200, json={"id": f"db-{call_count}"})

            mock.post(f"{NOTION_API_BASE}/v1/databases").mock(side_effect=_handler)
            # PATCH path uses the id from the create response — mock all
            # PATCHes to /v1/databases/* succeed.
            mock.patch(url__regex=rf"^{NOTION_API_BASE}/v1/databases/.+").respond(
                200, json={"ok": True}
            )
            deps = make_deps(fs, http)
            results = await asyncio.gather(
                get_or_create_database(deps),
                get_or_create_database(deps),
                get_or_create_database(deps),
            )

    # All three callers got the SAME id — second + third entered the
    # lock after the first persisted it, found `databaseId` set, and
    # short-circuited without re-creating.
    assert call_count == 1
    assert results == ["db-1", "db-1", "db-1"]


@pytest.mark.asyncio
async def test_clear_database_id_on_not_found_resets_for_rebootstrap() -> None:
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs, database_id="db-old", granted_parent_pages=["page-a"])
    async with httpx.AsyncClient() as http:
        deps = make_deps(fs, http)
        await clear_database_id_on_not_found(deps)
        cfg = await deps.config_store.get("u1")
        assert cfg is not None and cfg.databaseId is None
