"""Unit tests for Calendar edit/delete workspace tools."""

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

    async def delete(self, uid: str) -> None:
        pass


class _Request:
    def __init__(self, response: Any) -> None:
        self._response = response

    def execute(self) -> Any:
        return self._response


class _Events:
    def __init__(self, response: dict[str, Any]) -> None:
        self.response = response
        self.patch_kwargs: dict[str, Any] | None = None
        self.delete_kwargs: dict[str, Any] | None = None

    def patch(self, **kwargs: Any) -> _Request:
        self.patch_kwargs = kwargs
        return _Request(self.response)

    def delete(self, **kwargs: Any) -> _Request:
        self.delete_kwargs = kwargs
        return _Request({})


class _CalendarClient:
    def __init__(self, events: _Events) -> None:
        self._events = events

    def events(self) -> _Events:
        return self._events


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


def test_time_block_uses_date_for_all_day_values() -> None:
    assert _time_block("2026-06-01") == {"date": "2026-06-01"}
    assert _time_block("2026-06-01T12:00:00+00:00") == {"dateTime": "2026-06-01T12:00:00+00:00"}


@pytest.mark.asyncio
async def test_edit_calendar_event_patches_only_supplied_fields() -> None:
    events = _Events(
        {
            "id": "ev1",
            "summary": "Sink Repair",
            "start": {"dateTime": "2026-06-01T12:00:00+00:00"},
            "end": {"dateTime": "2026-06-01T12:30:00+00:00"},
            "attendees": [{"email": "laura.janeuk@googlemail.com"}],
        }
    )

    def build_client(service: str, access_token: str) -> Any:
        assert service == "calendar"
        assert access_token == "stub-token"
        return _CalendarClient(events)

    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=build_client,
    )
    tool = create_edit_calendar_event_tool(deps)

    out = await _call_tool(
        tool,
        eventId="ev1",
        attendees=["laura.janeuk@googlemail.com"],
        calendarId="primary",
    )

    assert out["status"] == "ok"
    assert out["event"]["attendees"] == ["laura.janeuk@googlemail.com"]
    assert events.patch_kwargs == {
        "calendarId": "primary",
        "eventId": "ev1",
        "sendUpdates": "all",
        "body": {"attendees": [{"email": "laura.janeuk@googlemail.com"}]},
    }


@pytest.mark.asyncio
async def test_edit_calendar_event_rejects_empty_patch() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    tool = create_edit_calendar_event_tool(deps)

    out = await _call_tool(tool, eventId="ev1")

    assert out["status"] == "error"
    assert out["code"] == "invalid_args"


@pytest.mark.asyncio
async def test_delete_calendar_event_calls_events_delete() -> None:
    events = _Events({})

    def build_client(service: str, access_token: str) -> Any:
        assert service == "calendar"
        return _CalendarClient(events)

    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=build_client,
    )
    tool = create_delete_calendar_event_tool(deps)

    out = await _call_tool(tool, eventId="ev1", calendarId="primary", sendUpdates="none")

    assert out == {"status": "ok", "deleted": "ev1", "calendarId": "primary"}
    assert events.delete_kwargs == {
        "calendarId": "primary",
        "eventId": "ev1",
        "sendUpdates": "none",
    }
