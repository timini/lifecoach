"""Unit tests for the bulk Gmail fetch tool."""

from __future__ import annotations

import base64
import sys
from typing import Any

import pytest

from lifecoach_agent.workspace_agent.run_gws import RunGwsErr, RunGwsLogEvent, RunGwsOk
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.get_messages import (
    GET_MESSAGES_TOOL_NAME,
    _normalise_ids,
    create_get_messages_tool,
)

_GET_MESSAGES_MODULE = sys.modules["lifecoach_agent.workspace_agent.tools.get_messages"]


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


def _raw_message(mid: str, *, subject: str) -> dict[str, Any]:
    body = base64.urlsafe_b64encode(f"Body for {mid}".encode()).decode().rstrip("=")
    return {
        "id": mid,
        "threadId": f"t-{mid}",
        "snippet": f"Snippet for {mid}",
        "payload": {
            "headers": [
                {"name": "From", "value": "Alex <alex@example.com>"},
                {"name": "Subject", "value": subject},
                {"name": "Date", "value": "Mon, 11 May 2026 09:00:00 +0100"},
            ],
            "mimeType": "text/plain",
            "body": {"data": body},
        },
    }


@pytest.mark.asyncio
async def test_get_messages_fetches_unique_ids_in_bulk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    events: list[RunGwsLogEvent] = []

    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        calls.append(kwargs)
        mid = kwargs["params"]["id"]
        return RunGwsOk(body=_raw_message(mid, subject=f"Subject {mid}"), truncated=False)

    monkeypatch.setattr(_GET_MESSAGES_MODULE, "run_gws", fake_run_gws)
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1", log=events.append)
    tool = create_get_messages_tool(deps)

    result = await tool.run_async(
        args={"ids": ["m1", "m2", "m1", "  "]},
        tool_context=None,
    )

    assert result["status"] == "ok"
    assert result["count"] == 2
    assert [m["id"] for m in result["messages"]] == ["m1", "m2"]
    assert result["messages"][0]["subject"] == "Subject m1"
    assert result["messages"][0]["body"] == "Body for m1"
    assert [call["tool_name"] for call in calls] == [GET_MESSAGES_TOOL_NAME, GET_MESSAGES_TOOL_NAME]
    assert [call["params"]["id"] for call in calls] == ["m1", "m2"]
    assert all(call["params"]["format"] == "full" for call in calls)


@pytest.mark.asyncio
async def test_get_messages_returns_top_level_error_when_all_fetches_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_gws(**kwargs: Any) -> RunGwsErr:
        return RunGwsErr(status="error", code="scope_required", message="reconnect")

    monkeypatch.setattr(_GET_MESSAGES_MODULE, "run_gws", fake_run_gws)
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")
    tool = create_get_messages_tool(deps)

    result = await tool.run_async(args={"ids": ["m1", "m2"]}, tool_context=None)

    assert result["status"] == "error"
    assert result["code"] == "scope_required"
    assert result["count"] == 0
    assert [err["id"] for err in result["errors"]] == ["m1", "m2"]


def test_normalise_ids_dedupes_skips_blanks_and_caps() -> None:
    ids = ["m1", " ", "m2", "m1", *[f"m{i}" for i in range(3, 60)]]

    result = _normalise_ids(ids)

    assert result[:3] == ["m1", "m2", "m3"]
    assert len(result) == 50
