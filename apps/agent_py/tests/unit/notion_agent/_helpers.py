"""Shared test helpers for notion_agent tests."""

from __future__ import annotations

from typing import Any

import httpx

from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps
from lifecoach_agent.oauth.notion_client import NotionRefreshResult, NotionTokens
from lifecoach_agent.storage.notion_config import create_notion_config_store
from lifecoach_agent.storage.notion_tokens import create_notion_tokens_store
from tests.unit.storage._fakes import FakeFirestore


class FakeOAuth:
    async def exchange_code(self, code: str, redirect_uri: str) -> NotionTokens:
        raise NotImplementedError

    async def refresh_access_token(self, refresh_token: str) -> NotionRefreshResult:
        return NotionRefreshResult(
            accessToken="AT2",
            accessTokenExpiresAt="2099-01-01T00:00:00.000Z",
            refreshToken=None,
        )


def seed_token(fs: FakeFirestore, uid: str = "u1") -> None:
    fs.docs[f"notionTokens/{uid}"] = {
        "uid": uid,
        "accessToken": "AT",
        "accessTokenExpiresAt": "2099-01-01T00:00:00.000Z",
        "refreshToken": "RT",
        "botId": "bot-1",
        "workspaceId": "ws-1",
        "workspaceName": "Test",
        "grantedAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-05-01T00:00:00.000Z",
    }


def seed_config(
    fs: FakeFirestore,
    uid: str = "u1",
    *,
    database_id: str | None = "db-existing",
    granted_parent_pages: list[str] | None = None,
) -> None:
    fs.docs[f"notionConfig/{uid}"] = {
        "uid": uid,
        "databaseId": database_id,
        "workspaceId": "ws-1",
        # Use `is None` so an explicitly-empty list passed by a test
        # round-trips without the `or` operator filling it back in.
        "grantedParentPageIds": ["page-a"]
        if granted_parent_pages is None
        else granted_parent_pages,
        "updatedAt": "2026-05-01T00:00:00.000Z",
    }


def make_deps(fs: FakeFirestore, http: httpx.AsyncClient, uid: str = "u1") -> NotionToolDeps:
    return NotionToolDeps(
        store=create_notion_tokens_store(
            firestore=fs, oauth_client=FakeOAuth(), now_ms=lambda: 1746522000000
        ),
        config_store=create_notion_config_store(firestore=fs, now_ms=lambda: 1746522000000),
        uid=uid,
        http=http,
        log=None,
    )


def page_obj(
    *,
    id: str,  # noqa: A002
    title: str = "T",
    status: str = "To Do",
    project: str | None = None,
    parent_id: str | None = None,
) -> dict[str, Any]:
    """Build a minimal Notion page object suitable for project_notion_task."""
    return {
        "id": id,
        "url": f"https://www.notion.so/{id}",
        "created_time": "2026-05-14T00:00:00.000Z",
        "last_edited_time": "2026-05-14T00:00:00.000Z",
        "properties": {
            "Task": {"title": [{"plain_text": title}]},
            "Status": {"select": {"name": status}},
            "Project": ({"select": {"name": project}} if project else {"select": None}),
            "Parent item": ({"relation": [{"id": parent_id}]} if parent_id else {"relation": []}),
        },
    }
