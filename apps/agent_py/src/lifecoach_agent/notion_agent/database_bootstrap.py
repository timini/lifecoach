"""Auto-bootstrap the user's "Lifecoach Tasks" Notion database.

Called lazily by every read/write tool: on first invocation after the
OAuth grant, this creates the DB under the parent page the user shared
during consent, persists the new id on `notionConfig/{uid}`, and
returns it. Subsequent calls hit the cached id.

Race protection: a per-uid asyncio.Lock prevents two simultaneous tool
calls from creating duplicate databases. Belt-and-braces: if the
create call returns a validation error referencing a duplicate name
(e.g., a previous bootstrap that we lost state on), we fall through
to searching the parent page for an existing DB by title.

The DB property schema is the single source of truth — see
NOTION_DB_PROPERTIES below. The projection layer
(`projections/task.py`) reads from these property keys verbatim.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from lifecoach_agent.notion_agent.notion_client import call_notion
from lifecoach_agent.notion_agent.run_notion import RunNotionErr, RunNotionOk, run_notion
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps

LIFECOACH_TASKS_DB_TITLE = "Lifecoach Tasks"


class DatabaseUnavailableError(Exception):
    """Raised when we can't resolve a `databaseId` for the user — e.g.
    they revoked the integration mid-call, or their consent grant
    didn't include any parent pages we can create under."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# Schema baked into the initial CREATE call. The property names here are
# the exact keys `projections/task.py` and the write tools look up —
# never rename without updating both ends.
#
# The "Parent item" self-relation is added in a second PATCH after the
# DB exists — Notion's create-database endpoint validates
# `relation.database_id` against real database ids, so we can't include
# a self-relation in the initial POST (we don't have the id yet, and
# Notion has no sentinel value like "__SELF__"). See
# `_add_parent_item_self_relation` below.
NOTION_DB_PROPERTIES: dict[str, Any] = {
    "Task": {"title": {}},
    "Status": {
        "select": {
            "options": [
                {"name": "To Do", "color": "default"},
                {"name": "In Progress", "color": "blue"},
                {"name": "Waiting", "color": "yellow"},
                {"name": "Done", "color": "green"},
            ]
        }
    },
    "Priority": {
        "select": {
            "options": [
                {"name": "Urgent", "color": "red"},
                {"name": "High", "color": "orange"},
                {"name": "Medium", "color": "yellow"},
                {"name": "Low", "color": "gray"},
            ]
        }
    },
    "Project": {"select": {"options": []}},
    "Due Date": {"date": {}},
    "Notes": {"rich_text": {}},
}


# Per-process per-uid lock — one /chat handler instance lives in
# memory long enough to serve many requests; collapsing concurrent
# first-call bootstraps onto a single lock per uid prevents duplicate
# DB creates within a single process instance.
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(uid: str) -> asyncio.Lock:
    lock = _locks.get(uid)
    if lock is None:
        lock = asyncio.Lock()
        _locks[uid] = lock
    return lock


async def _create_database(
    *,
    deps: NotionToolDeps,
    parent_page_id: str,
) -> str:
    """POST /v1/databases (without Parent item). Returns the new DB id.

    The self-relation `Parent item` is added separately by
    `_add_parent_item_self_relation` after creation — Notion's create
    endpoint validates `relation.database_id` against real ids, so we
    have to do this in two steps. Splitting these into two callables
    also lets `get_or_create_database` apply the search-fallback only
    around the POST (a failed PATCH is distinct from a duplicate-name
    POST and shouldn't trigger search-by-title).
    """
    body = {
        "parent": {"type": "page_id", "page_id": parent_page_id},
        "title": [{"type": "text", "text": {"content": LIFECOACH_TASKS_DB_TITLE}}],
        "properties": NOTION_DB_PROPERTIES,
    }

    result = await run_notion(
        store=deps.store,
        uid=deps.uid,
        tool_name="bootstrap_database",
        method="POST",
        path="/v1/databases",
        body=body,
        http=deps.http,
        log=deps.log,
    )
    if isinstance(result, RunNotionErr):
        raise DatabaseUnavailableError(result.code, result.message)
    assert isinstance(result, RunNotionOk)
    db = result.body if isinstance(result.body, dict) else {}
    db_id = db.get("id")
    if not isinstance(db_id, str) or not db_id:
        raise DatabaseUnavailableError("upstream", "create-database response missing id")
    return db_id


async def _add_parent_item_self_relation(
    *,
    deps: NotionToolDeps,
    database_id: str,
) -> None:
    """PATCH the just-created DB to add `Parent item` as a single-property
    self-relation. Required for sub-tasks. Raises DatabaseUnavailableError
    on failure — the caller has already created the DB but it is not
    fully bootstrapped until this succeeds."""
    body = {
        "properties": {
            "Parent item": {
                "relation": {
                    "database_id": database_id,
                    "type": "single_property",
                    "single_property": {},
                }
            }
        }
    }
    result = await run_notion(
        store=deps.store,
        uid=deps.uid,
        tool_name="bootstrap_parent_relation",
        method="PATCH",
        path=f"/v1/databases/{database_id}",
        body=body,
        http=deps.http,
        log=deps.log,
    )
    if isinstance(result, RunNotionErr):
        raise DatabaseUnavailableError(
            result.code,
            f"created database but failed to add Parent item relation: {result.message}",
        )


async def _discover_granted_parent_pages(
    *,
    deps: NotionToolDeps,
) -> list[str]:
    """Fallback: find pages the integration was granted access to.

    Notion's OAuth exchange response embeds the workspace + bot id but
    does NOT enumerate the pages the user shared during consent — the
    only programmatic way to find them is `/v1/search` post-grant. We
    persist whatever comes back so subsequent bootstraps don't repeat
    this lookup."""
    result = await run_notion(
        store=deps.store,
        uid=deps.uid,
        tool_name="bootstrap_discover_pages",
        method="POST",
        path="/v1/search",
        body={
            "filter": {"value": "page", "property": "object"},
            "page_size": 25,
        },
        http=deps.http,
        log=deps.log,
    )
    if isinstance(result, RunNotionErr):
        return []
    assert isinstance(result, RunNotionOk)
    body = result.body if isinstance(result.body, dict) else {}
    ids: list[str] = []
    for hit in body.get("results") or []:
        if not isinstance(hit, dict):
            continue
        # Skip database results — we want pages we can create a
        # database under, not databases themselves.
        if hit.get("object") != "page":
            continue
        page_id = hit.get("id")
        if isinstance(page_id, str) and page_id:
            ids.append(page_id)
    return ids


async def _search_existing_database(
    *,
    deps: NotionToolDeps,
    parent_page_id: str,
) -> str | None:
    """Fallback: find an existing "Lifecoach Tasks" DB the integration
    has access to. Called only when create fails with a duplicate-name
    style validation error."""
    result = await run_notion(
        store=deps.store,
        uid=deps.uid,
        tool_name="bootstrap_database_search",
        method="POST",
        path="/v1/search",
        body={
            "query": LIFECOACH_TASKS_DB_TITLE,
            "filter": {"value": "database", "property": "object"},
            "page_size": 10,
        },
        http=deps.http,
        log=deps.log,
    )
    if isinstance(result, RunNotionErr):
        return None
    assert isinstance(result, RunNotionOk)
    body = result.body if isinstance(result.body, dict) else {}
    for hit in body.get("results") or []:
        if not isinstance(hit, dict):
            continue
        # Confirm it's parented under the right page and has the
        # exact title — Notion's search is fuzzy.
        title_fragments = hit.get("title") or []
        if not isinstance(title_fragments, list):
            continue
        title = "".join(f.get("plain_text", "") for f in title_fragments if isinstance(f, dict))
        if title.strip() != LIFECOACH_TASKS_DB_TITLE:
            continue
        parent = hit.get("parent") if isinstance(hit.get("parent"), dict) else {}
        if parent.get("page_id") != parent_page_id:
            continue
        db_id = hit.get("id")
        if isinstance(db_id, str) and db_id:
            return db_id
    return None


async def _verify_database_exists(
    *,
    deps: NotionToolDeps,
    database_id: str,
) -> bool:
    """Sanity-check a stored databaseId — if Notion now 404s on it
    (user revoked + re-granted without re-sharing this page) we clear
    it and re-bootstrap on the next call."""
    result = await run_notion(
        store=deps.store,
        uid=deps.uid,
        tool_name="bootstrap_verify",
        method="GET",
        path=f"/v1/databases/{database_id}",
        http=deps.http,
        log=deps.log,
    )
    if isinstance(result, RunNotionErr):
        # 401 / 404 → stale. Anything else (rate_limit etc.) we treat
        # as "still exists, just transient error" and let the caller
        # surface its own error.
        return result.code not in ("not_found", "scope_required")
    return True


async def get_or_create_database(deps: NotionToolDeps) -> str:
    """Resolve the per-uid database id. Auto-creates on first call.

    Caller MUST be inside a try/except for DatabaseUnavailableError —
    the most common surface is a user revoking the integration between
    OAuth grant and their first tool call.
    """
    async with _lock_for(deps.uid):
        config = await deps.config_store.get(deps.uid)
        if config is None:
            raise DatabaseUnavailableError(
                "scope_required",
                "Notion config missing — has the user connected yet?",
            )

        if config.databaseId:
            # Cheap path: trust the cached id. The verify-on-404 path
            # only fires if a downstream tool call hits 404 — see
            # `clear_database_id_on_not_found` below.
            return config.databaseId

        granted_pages = list(config.grantedParentPageIds)
        if not granted_pages:
            # First bootstrap after OAuth — discover pages now and
            # persist them, so this lookup is one-shot per uid.
            granted_pages = await _discover_granted_parent_pages(deps=deps)
            if not granted_pages:
                raise DatabaseUnavailableError(
                    "bad_request",
                    "Notion connect did not include a parent page; ask the user to "
                    "share at least one page with the integration at "
                    "notion.so/my-integrations and try again.",
                )
            await deps.config_store.set_granted_parent_page_ids(deps.uid, granted_pages)

        parent_page_id = granted_pages[0]
        from_search = False
        try:
            db_id = await _create_database(deps=deps, parent_page_id=parent_page_id)
        except DatabaseUnavailableError as err:
            # Fall back to search-by-title if Notion's complaint sounds
            # like a duplicate. We can't easily distinguish reliably
            # from the error code alone, so we always try a search on
            # `bad_request` before re-raising.
            if err.code != "bad_request":
                raise
            existing = await _search_existing_database(deps=deps, parent_page_id=parent_page_id)
            if existing is None:
                raise
            db_id = existing
            from_search = True

        # Add the Parent item self-relation. We skip this for DBs found
        # via search-fallback (they already exist and likely already
        # have the property; a re-PATCH would be a no-op at best, an
        # error at worst). New DBs MUST be patched — sub-tasks rely
        # on this property.
        if not from_search:
            await _add_parent_item_self_relation(deps=deps, database_id=db_id)

        await deps.config_store.set_database_id(deps.uid, db_id)
        return db_id


async def clear_database_id_on_not_found(deps: NotionToolDeps) -> None:
    """Reset the cached databaseId so the next tool call re-bootstraps.
    Called when a downstream operation gets a `not_found` against the
    stored id — most commonly after the user revokes + re-grants
    without re-sharing the previous parent page."""
    await deps.config_store.set_database_id(deps.uid, None)


# Re-export call_notion + httpx for external mocking in tests.
_re_export: Any = (call_notion, httpx)
