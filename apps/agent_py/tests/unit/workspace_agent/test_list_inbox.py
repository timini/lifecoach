"""Unit tests for the Gmail inbox-listing tool.

Covers issue #140: the query must scope to the *visible* inbox (never
archived / moved mail) and each distinct message id must be read at most
once even when Gmail's list response repeats it.
"""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.list_inbox import (
    _build_inbox_query,
    _dedupe_message_ids,
    create_list_inbox_tool,
)


def test_build_inbox_query_uses_in_inbox_scope_and_time_window() -> None:
    assert _build_inbox_query(unread_only=False, since="1d") == "in:inbox newer_than:1d"
    assert _build_inbox_query(unread_only=True, since="12h") == "in:inbox is:unread newer_than:12h"


def test_dedupe_message_ids_keeps_first_seen_order_and_drops_junk() -> None:
    messages = [
        {"id": "a"},
        {"id": "b"},
        {"id": "a"},  # duplicate
        {"id": ""},  # empty
        {"no_id": True},  # malformed
        "not-a-dict",
        {"id": "c"},
    ]
    assert _dedupe_message_ids(messages) == ["a", "b", "c"]
    assert _dedupe_message_ids(None) == []


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


class _Request:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body

    def execute(self) -> dict[str, Any]:
        return self._body


def _build_client_with_captured_calls(calls: list[dict[str, Any]]) -> Any:
    """Fake Gmail discovery client that records list/get params and
    simulates Gmail leaking archived mail *only* if the query forgets the
    `in:inbox` scope. The list response also repeats an id so the dedupe
    path is exercised end-to-end."""

    inbox_messages = [
        {"id": "inbox-1", "threadId": "thread-1", "snippet": "first inbox message"},
        {"id": "inbox-2", "threadId": "thread-2", "snippet": "second inbox message"},
    ]
    archived_messages = [
        {"id": "archived-1", "threadId": "thread-a", "snippet": "archived message"},
    ]
    by_id = {m["id"]: m for m in [*inbox_messages, *archived_messages]}

    class _Messages:
        def list(self, **kwargs: Any) -> _Request:
            calls.append({"method": "list", "params": kwargs})
            q = kwargs.get("q", "")
            ids = ["inbox-1", "inbox-2", "inbox-1"]  # note the duplicate
            if "in:inbox" not in q:
                ids.extend(m["id"] for m in archived_messages)
            return _Request({"messages": [{"id": mid} for mid in ids]})

        def get(self, **kwargs: Any) -> _Request:
            calls.append({"method": "get", "params": kwargs})
            return _Request(by_id[kwargs["id"]])

    class _Users:
        def messages(self) -> _Messages:
            return _Messages()

    class _Client:
        def users(self) -> _Users:
            return _Users()

    def _factory(service: str, access_token: str) -> Any:
        assert service == "gmail"
        assert access_token == "stub-token"
        return _Client()

    return _factory


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    """Invoke the ADK `FunctionTool` by unwrapping its underlying callable."""
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


def _deps(calls: list[dict[str, Any]]) -> WorkspaceToolDeps:
    return WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_with_captured_calls(calls),
    )


@pytest.mark.asyncio
async def test_list_inbox_query_is_inbox_scoped_with_time_window() -> None:
    calls: list[dict[str, Any]] = []
    out = await _call_tool(
        create_list_inbox_tool(_deps(calls)), unread_only=True, since="12h", limit=25
    )

    list_calls = [c for c in calls if c["method"] == "list"]
    assert len(list_calls) == 1
    assert list_calls[0]["params"]["q"] == "in:inbox is:unread newer_than:12h"
    assert list_calls[0]["params"]["maxResults"] == 25
    # Archived mail never appears because the query is inbox-scoped.
    assert [m["id"] for m in out["messages"]] == ["inbox-1", "inbox-2"]


@pytest.mark.asyncio
async def test_list_inbox_reads_each_distinct_id_once() -> None:
    calls: list[dict[str, Any]] = []
    out = await _call_tool(create_list_inbox_tool(_deps(calls)), since="1d")

    get_ids = [c["params"]["id"] for c in calls if c["method"] == "get"]
    assert get_ids == ["inbox-1", "inbox-2"]  # the duplicate inbox-1 was de-duped
    assert [m["id"] for m in out["messages"]] == ["inbox-1", "inbox-2"]
