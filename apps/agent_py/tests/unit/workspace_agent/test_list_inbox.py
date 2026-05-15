"""Unit tests for `list_inbox` Gmail query scope and per-run de-dupe."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.list_inbox import create_list_inbox_tool


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    """Invoke the ADK `FunctionTool` by unwrapping its underlying callable."""
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


class _Request:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body

    def execute(self) -> dict[str, Any]:
        return self._body


def _build_client_with_captured_calls(calls: list[dict[str, Any]]) -> Any:
    """Fake Gmail client that records list/get params and simulates Gmail
    returning archived mail only if the query forgets the inbox scope."""

    inbox_messages = [
        {"id": "inbox-1", "threadId": "thread-1", "snippet": "first inbox message"},
        {"id": "inbox-2", "threadId": "thread-2", "snippet": "second inbox message"},
    ]
    archived_messages = [
        {"id": "archived-1", "threadId": "thread-a", "snippet": "archived message"},
        {"id": "archived-2", "threadId": "thread-b", "snippet": "archived message"},
    ]

    class _Messages:
        def list(self, **kwargs: Any) -> _Request:
            calls.append({"method": "list", "params": kwargs})
            q = kwargs.get("q", "")
            ids = ["inbox-1", "inbox-2", "inbox-1"]
            if "in:inbox" not in q:
                ids.extend(m["id"] for m in archived_messages)
            return _Request({"messages": [{"id": mid} for mid in ids]})

        def get(self, **kwargs: Any) -> _Request:
            calls.append({"method": "get", "params": kwargs})
            message_id = kwargs["id"]
            for message in [*inbox_messages, *archived_messages]:
                if message["id"] == message_id:
                    return _Request(message)
            raise AssertionError(f"unexpected id {message_id}")

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


@pytest.mark.asyncio
async def test_list_inbox_query_is_inbox_scoped_and_time_windowed() -> None:
    calls: list[dict[str, Any]] = []
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_with_captured_calls(calls),
    )
    tool = create_list_inbox_tool(deps)

    out = await _call_tool(tool, unread_only=True, since="12h", limit=25)

    list_calls = [call for call in calls if call["method"] == "list"]
    assert len(list_calls) == 1
    assert list_calls[0]["params"] == {
        "userId": "me",
        "q": "in:inbox is:unread newer_than:12h",
        "maxResults": 25,
    }
    assert out["status"] == "ok"
    assert [message["id"] for message in out["messages"]] == ["inbox-1", "inbox-2"]


@pytest.mark.asyncio
async def test_list_inbox_deduplicates_before_reading_message_metadata() -> None:
    calls: list[dict[str, Any]] = []
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_with_captured_calls(calls),
    )
    tool = create_list_inbox_tool(deps)

    out = await _call_tool(tool, since="1d")

    get_ids = [call["params"]["id"] for call in calls if call["method"] == "get"]
    assert get_ids == ["inbox-1", "inbox-2"]
    assert [message["id"] for message in out["messages"]] == ["inbox-1", "inbox-2"]
