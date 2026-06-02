"""Unit tests for calendar edit/delete write tools."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.delete_calendar_event import (
    create_delete_calendar_event_tool,
)
from lifecoach_agent.workspace_agent.tools.edit_calendar_event import (
    _time_block,
    create_edit_calendar_event_tool,
)


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:  # pragma: no cover - auth-path smoke only
        raise AssertionError("delete should not be called for successful writes")


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


def test_time_block_uses_date_for_all_day_values() -> None:
    assert _time_block("2026-06-01") == {"date": "2026-06-01"}
    assert _time_block("2026-06-01T12:00:00Z") == {"dateTime": "2026-06-01T12:00:00Z"}


@pytest.mark.asyncio
async def test_edit_calendar_event_patches_only_supplied_fields() -> None:
    captured: dict[str, Any] = {}

    class _Request:
        def execute(self) -> dict[str, Any]:
            return {
                "id": captured["eventId"],
                "summary": captured["body"]["summary"],
                "start": {"dateTime": "2026-06-01T12:00:00Z"},
                "end": {"dateTime": "2026-06-01T12:30:00Z"},
                "attendees": captured["body"]["attendees"],
            }

    class _Events:
        def patch(self, **kwargs: Any) -> _Request:
            captured.update(kwargs)
            return _Request()

    class _Client:
        def events(self) -> _Events:
            return _Events()

    def _build_client(service: str, access_token: str) -> _Client:
        assert service == "calendar"
        assert access_token == "stub-token"
        return _Client()

    tool = create_edit_calendar_event_tool(
        WorkspaceToolDeps(
            store=_FakeStore(),  # type: ignore[arg-type]
            uid="u1",
            build_client=_build_client,
        )
    )

    out = await _call_tool(
        tool,
        id="evt-1",
        summary="Sink Repair",
        attendees=["existing@example.com", "laura.janeuk@googlemail.com"],
    )

    assert captured == {
        "calendarId": "primary",
        "eventId": "evt-1",
        "sendUpdates": "all",
        "body": {
            "summary": "Sink Repair",
            "attendees": [
                {"email": "existing@example.com"},
                {"email": "laura.janeuk@googlemail.com"},
            ],
        },
    }
    assert out["status"] == "ok"
    assert out["event"]["id"] == "evt-1"
    assert out["event"]["attendees"] == ["existing@example.com", "laura.janeuk@googlemail.com"]


@pytest.mark.asyncio
async def test_edit_calendar_event_rejects_empty_patch() -> None:
    tool = create_edit_calendar_event_tool(
        WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    )

    out = await _call_tool(tool, id="evt-1")

    assert out == {
        "status": "error",
        "code": "invalid_args",
        "message": "provide at least one event field to edit",
    }


@pytest.mark.asyncio
async def test_delete_calendar_event_calls_calendar_delete() -> None:
    captured: dict[str, Any] = {}

    class _Request:
        def execute(self) -> dict[str, Any]:
            return {}

    class _Events:
        def delete(self, **kwargs: Any) -> _Request:
            captured.update(kwargs)
            return _Request()

    class _Client:
        def events(self) -> _Events:
            return _Events()

    tool = create_delete_calendar_event_tool(
        WorkspaceToolDeps(
            store=_FakeStore(),  # type: ignore[arg-type]
            uid="u1",
            build_client=lambda service, access_token: _Client(),
        )
    )

    out = await _call_tool(tool, id="evt-1", sendUpdates="none")

    assert captured == {"calendarId": "primary", "eventId": "evt-1", "sendUpdates": "none"}
    assert out == {"status": "ok", "deleted": "evt-1", "calendarId": "primary"}
