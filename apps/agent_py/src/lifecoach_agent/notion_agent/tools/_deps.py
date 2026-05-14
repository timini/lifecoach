"""Shared dependencies for Notion tools (writes + sub-agent reads)."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from lifecoach_agent.notion_agent.run_notion import LogEmitter
from lifecoach_agent.storage.notion_config import NotionConfigStore
from lifecoach_agent.storage.notion_tokens import NotionTokensStore


@dataclass(frozen=True)
class NotionToolDeps:
    """Closure for every Notion tool. Holds the per-uid stores, an
    optional shared httpx client (tests inject a respx-bound one), and
    an optional log emitter. The database_bootstrap helper resolves
    the user's `databaseId` from this on every call that needs it."""

    store: NotionTokensStore
    config_store: NotionConfigStore
    uid: str
    http: httpx.AsyncClient | None = None
    log: LogEmitter | None = None
