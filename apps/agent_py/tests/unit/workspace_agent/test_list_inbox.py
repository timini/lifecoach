"""Unit tests for the Gmail inbox-listing tool."""

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


class _Request:
    def __init__(self, response: Any) -> None:
        self._response = response

    def execute(self) -> Any:
        return self._response


class _Messages:
    def __init__(self, messages: dict[str, dict[str, Any]]) -> None:
        self._messages = messages
        self.list_calls: list[dict[str, Any]] = []
        self.get_calls: list[dict[str, Any]] = []

    def list(self, **kwargs: Any) -> _Request:
        self.list_calls.append(kwargs)
        q = kwargs.get("q")
        listed = [
            {"id": mid}
            for mid, message in self._messages.items()
            if "INBOX" in message.get("labelIds", [])
            and ("in:inbox" in q)
            and ("is:unread" not in q or "UNREAD" in message.get("labelIds", []))
        ]
        # Gmail can occasionally surface duplicate ids via paging / query overlap;
        # the tool should still fetch metadata for each id only once.
        if listed:
            listed.append(dict(listed[0]))
        return _Request({"messages": listed})

    def get(self, **kwargs: Any) -> _Request:
        self.get_calls.append(kwargs)
        message = self._messages[kwargs["id"]]
        return _Request(
            {
                "id": kwargs["id"],
                "threadId": message.get("threadId"),
                "snippet": message.get("snippet"),
            }
        )


class _Users:
    def __init__(self, messages: _Messages) -> None:
        self._messages = messages

    def messages(self) -> _Messages:
        return self._messages


class _GmailClient:
    def __init__(self, messages: _Messages) -> None:
        self._users = _Users(messages)

    def users(self) -> _Users:
        return self._users


def _build_client_factory(messages: _Messages) -> Any:
    def _factory(service: str, access_token: str) -> _GmailClient:
        assert service == "gmail"
        assert access_token == "stub-token"
        return _GmailClient(messages)

    return _factory


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


@pytest.mark.asyncio
async def test_list_inbox_query_is_inbox_scoped_with_time_window() -> None:
    messages = _Messages(
        {
            "inbox-1": {"labelIds": ["INBOX"], "threadId": "t1", "snippet": "visible"},
            "archived-1": {"labelIds": [], "threadId": "t2", "snippet": "archived"},
        }
    )
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(messages),
    )

    out = await _call_tool(create_list_inbox_tool(deps), since="3d", limit=10)

    assert messages.list_calls[0]["q"] == "in:inbox newer_than:3d"
    assert [m["id"] for m in out["messages"]] == ["inbox-1"]
    assert [call["id"] for call in messages.get_calls] == ["inbox-1"]


@pytest.mark.asyncio
async def test_list_inbox_unread_query_keeps_inbox_scope_and_dedupes_reads() -> None:
    messages = _Messages(
        {
            "unread-inbox": {
                "labelIds": ["INBOX", "UNREAD"],
                "threadId": "t1",
                "snippet": "unread visible",
            },
            "read-inbox": {"labelIds": ["INBOX"], "threadId": "t2", "snippet": "read"},
            "unread-archived": {"labelIds": ["UNREAD"], "threadId": "t3", "snippet": "archived"},
        }
    )
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(messages),
    )

    out = await _call_tool(create_list_inbox_tool(deps), unread_only=True, since="12h", limit=10)

    assert messages.list_calls[0]["q"] == "is:unread in:inbox newer_than:12h"
    assert [m["id"] for m in out["messages"]] == ["unread-inbox"]
    assert [call["id"] for call in messages.get_calls] == ["unread-inbox"]
