from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk
from lifecoach_agent.workspace_agent.tools import get_message as get_message_module
from lifecoach_agent.workspace_agent.tools import list_inbox as list_inbox_module
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "token"


@pytest.mark.asyncio
async def test_list_inbox_uses_in_inbox_time_window_and_dedupes_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        calls.append(kwargs)
        if kwargs["method"] == "list":
            return RunGwsOk(
                body={
                    "messages": [
                        {"id": "inbox-1"},
                        {"id": "inbox-1"},
                        {"id": "inbox-2"},
                    ]
                }
            )
        return RunGwsOk(
            body={
                "id": kwargs["params"]["id"],
                "threadId": f"thread-{kwargs['params']['id']}",
                "snippet": f"snippet-{kwargs['params']['id']}",
            }
        )

    monkeypatch.setattr(list_inbox_module, "run_gws", fake_run_gws)

    tool = list_inbox_module.create_list_inbox_tool(
        WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    )
    result = await tool.func(unread_only=True, since="12h", limit=99)

    assert result == {
        "status": "ok",
        "messages": [
            {"id": "inbox-1", "threadId": "thread-inbox-1", "snippet": "snippet-inbox-1"},
            {"id": "inbox-2", "threadId": "thread-inbox-2", "snippet": "snippet-inbox-2"},
        ],
    }
    assert calls[0]["params"] == {
        "userId": "me",
        "q": "in:inbox is:unread newer_than:12h",
        "maxResults": 50,
    }
    assert [call["params"]["id"] for call in calls[1:]] == ["inbox-1", "inbox-2"]


@pytest.mark.asyncio
async def test_get_message_returns_cached_response_for_duplicate_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        calls.append(kwargs)
        return RunGwsOk(
            body={
                "id": kwargs["params"]["id"],
                "threadId": "thread-1",
                "snippet": "hello",
                "payload": {
                    "headers": [
                        {"name": "From", "value": "a@example.com"},
                        {"name": "Subject", "value": "Hello"},
                    ]
                },
            }
        )

    monkeypatch.setattr(get_message_module, "run_gws", fake_run_gws)

    tool = get_message_module.create_get_message_tool(
        WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    )
    first = await tool.func(id="msg-1")
    second = await tool.func(id="msg-1")

    assert first == second
    assert first["status"] == "ok"
    assert first["message"]["id"] == "msg-1"
    assert [call["params"] for call in calls] == [{"userId": "me", "id": "msg-1", "format": "full"}]
