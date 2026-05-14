"""Tests for the per-uid Notion config store (databaseId + granted
parent pages)."""

from __future__ import annotations

import pytest

from lifecoach_agent.storage.notion_config import create_notion_config_store
from tests.unit.storage._fakes import FakeFirestore


@pytest.mark.asyncio
async def test_set_then_get_roundtrips() -> None:
    fs = FakeFirestore()
    store = create_notion_config_store(firestore=fs, now_ms=lambda: 1746522000000)
    saved = await store.set(
        "u1",
        workspace_id="ws-1",
        granted_parent_page_ids=["page-a", "page-b"],
    )
    assert saved.databaseId is None
    assert saved.grantedParentPageIds == ["page-a", "page-b"]

    fetched = await store.get("u1")
    assert fetched is not None
    assert fetched.workspaceId == "ws-1"
    assert fetched.grantedParentPageIds == ["page-a", "page-b"]


@pytest.mark.asyncio
async def test_set_database_id_preserves_granted_pages() -> None:
    fs = FakeFirestore()
    store = create_notion_config_store(firestore=fs, now_ms=lambda: 1746522000000)
    await store.set(
        "u1",
        workspace_id="ws-1",
        granted_parent_page_ids=["page-a"],
    )
    updated = await store.set_database_id("u1", "db-123")
    assert updated.databaseId == "db-123"
    assert updated.grantedParentPageIds == ["page-a"]


@pytest.mark.asyncio
async def test_set_database_id_to_none_forces_rebootstrap() -> None:
    """Re-grant path: after `object_not_found` the bootstrap clears
    the stored databaseId so the next call re-creates it under the
    newly-granted parent page."""
    fs = FakeFirestore()
    store = create_notion_config_store(firestore=fs, now_ms=lambda: 1746522000000)
    await store.set(
        "u1",
        workspace_id="ws-1",
        granted_parent_page_ids=["page-a"],
        database_id="db-old",
    )
    cleared = await store.set_database_id("u1", None)
    assert cleared.databaseId is None
    # Pages preserved so re-bootstrap has somewhere to create the DB.
    assert cleared.grantedParentPageIds == ["page-a"]


@pytest.mark.asyncio
async def test_set_database_id_with_no_existing_doc_synthesizes() -> None:
    """Edge case: someone calls set_database_id before set() was called.
    Don't crash; synthesize a minimal doc so we never lose state."""
    fs = FakeFirestore()
    store = create_notion_config_store(firestore=fs, now_ms=lambda: 1746522000000)
    synthed = await store.set_database_id("u1", "db-x")
    assert synthed.databaseId == "db-x"
    assert synthed.workspaceId == ""
    assert synthed.grantedParentPageIds == []


@pytest.mark.asyncio
async def test_delete_removes_doc() -> None:
    fs = FakeFirestore()
    store = create_notion_config_store(firestore=fs, now_ms=lambda: 1746522000000)
    await store.set(
        "u1",
        workspace_id="ws-1",
        granted_parent_page_ids=["page-a"],
    )
    await store.delete("u1")
    assert await store.get("u1") is None


@pytest.mark.asyncio
async def test_get_returns_none_when_missing() -> None:
    fs = FakeFirestore()
    store = create_notion_config_store(firestore=fs, now_ms=lambda: 1746522000000)
    assert await store.get("missing") is None
