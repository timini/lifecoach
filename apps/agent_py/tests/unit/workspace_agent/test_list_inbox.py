from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk
from lifecoach_agent.workspace_agent.tools import list_inbox as list_inbox_module
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.list_inbox import (
    _build_inbox_query,
    create_list_inbox_tool,
)


class _FakeTokensStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return f"token-for-{uid}"

    async def delete(self, uid: str) -> None:
        return None


def test_build_inbox_query_uses_in_inbox_scope_and_time_window() -> None:
    assert _build_inbox_query(unread_only=False, since="1d") == "in:inbox newer_than:1d"
    assert _build_inbox_query(unread_only=True, since="12h") == "in:inbox is:unread newer_than:12h"


@pytest.mark.asyncio
async def test_list_inbox_uses_inbox_query_and_reads_distinct_messages_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        calls.append(kwargs)
        method = kwargs["method"]
        params = kwargs["params"]
        if method == "list":
            return RunGwsOk(
                body={
                    "messages": [
                        {"id": "inbox-1"},
                        {"id": "inbox-2"},
                        {"id": "inbox-1"},
                        {"id": "inbox-3"},
                        {"id": "inbox-2"},
                    ]
                }
            )
        assert method == "get"
        mid = params["id"]
        return RunGwsOk(body={"id": mid, "threadId": f"thread-{mid}", "snippet": f"snippet {mid}"})

    monkeypatch.setattr(list_inbox_module, "run_gws", fake_run_gws)

    deps = WorkspaceToolDeps(store=_FakeTokensStore(), uid="u1")  # type: ignore[arg-type]
    tool = create_list_inbox_tool(deps)

    result = await tool.func(unread_only=False, since="1d", limit=50)

    assert result == {
        "status": "ok",
        "messages": [
            {"id": "inbox-1", "threadId": "thread-inbox-1", "snippet": "snippet inbox-1"},
            {"id": "inbox-2", "threadId": "thread-inbox-2", "snippet": "snippet inbox-2"},
            {"id": "inbox-3", "threadId": "thread-inbox-3", "snippet": "snippet inbox-3"},
        ],
    }

    list_calls = [call for call in calls if call["method"] == "list"]
    assert len(list_calls) == 1
    assert list_calls[0]["params"] == {
        "userId": "me",
        "q": "in:inbox newer_than:1d",
        "maxResults": 50,
    }

    get_ids = [call["params"]["id"] for call in calls if call["method"] == "get"]
    assert get_ids == ["inbox-1", "inbox-2", "inbox-3"]
