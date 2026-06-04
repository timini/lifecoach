"""Unit tests for Calendar event edit/delete workspace tools."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.delete_calendar_event import (
    create_delete_calendar_event_tool,
)
from lifecoach_agent.workspace_agent.tools.edit_calendar_event import (
    create_edit_calendar_event_tool,
)


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


def _build_calendar_client_factory(calls: list[tuple[str, dict[str, Any]]]) -> Any:
    class _Request:
        def __init__(self, body: Any = None) -> None:
            self._body = body

        def execute(self) -> Any:
            return self._body

    class _Events:
        def get(self, **kwargs: Any) -> _Request:
            calls.append(("get", kwargs))
            return _Request(
                {
                    "id": kwargs["eventId"],
                    "summary": "Sink Repair",
                    "start": {"dateTime": "2026-06-01T12:00:00Z"},
                    "end": {"dateTime": "2026-06-01T12:30:00Z"},
                    "attendees": [
                        {
                            "email": "owner@example.com",
                            "responseStatus": "accepted",
                            "displayName": "Owner",
                        }
                    ],
                }
            )

        def patch(self, **kwargs: Any) -> _Request:
            calls.append(("patch", kwargs))
            body = dict(kwargs.get("body") or {})
            return _Request(
                {
                    "id": kwargs["eventId"],
                    "summary": body.get("summary") or "Sink Repair",
                    "start": body.get("start") or {"dateTime": "2026-06-01T12:00:00Z"},
                    "end": body.get("end") or {"dateTime": "2026-06-01T12:30:00Z"},
                    "attendees": body.get("attendees") or [],
                }
            )

        def delete(self, **kwargs: Any) -> _Request:
            calls.append(("delete", kwargs))
            return _Request({})

    class _Client:
        def events(self) -> _Events:
            return _Events()

    def _factory(service: str, access_token: str) -> Any:
        assert service == "calendar"
        assert access_token == "stub-token"
        return _Client()

    return _factory


@pytest.mark.asyncio
async def test_edit_calendar_event_adds_attendee_without_removing_existing() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_calendar_client_factory(calls),
    )
    tool = create_edit_calendar_event_tool(deps)

    out = await _call_tool(
        tool,
        eventId="ev1",
        addAttendees=["Laura.JaneUK@googlemail.com", "owner@example.com"],
    )

    assert out["status"] == "ok"
    assert out["event"]["attendees"] == ["owner@example.com", "Laura.JaneUK@googlemail.com"]
    assert [name for name, _ in calls] == ["get", "patch"]
    patch_kwargs = calls[1][1]
    # Existing attendee carried over with its RSVP metadata intact; only the
    # new guest is appended as a bare email (Codex P2: don't reset RSVPs).
    assert patch_kwargs["body"]["attendees"] == [
        {"email": "owner@example.com", "responseStatus": "accepted", "displayName": "Owner"},
        {"email": "Laura.JaneUK@googlemail.com"},
    ]
    # Guests are notified of the change.
    assert patch_kwargs["sendUpdates"] == "all"


@pytest.mark.asyncio
async def test_edit_calendar_event_patches_time_and_summary() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_calendar_client_factory(calls),
    )
    tool = create_edit_calendar_event_tool(deps)

    out = await _call_tool(
        tool,
        eventId="ev1",
        summary="Sink Repair with Laura",
        start="2026-06-01T13:00:00Z",
        end="2026-06-01T13:30:00Z",
    )

    assert out["status"] == "ok"
    assert [name for name, _ in calls] == ["patch"]
    patch_body = calls[0][1]["body"]
    assert patch_body["summary"] == "Sink Repair with Laura"
    assert patch_body["start"] == {"dateTime": "2026-06-01T13:00:00Z"}
    assert patch_body["end"] == {"dateTime": "2026-06-01T13:30:00Z"}


@pytest.mark.asyncio
async def test_edit_calendar_event_requires_at_least_one_change() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    tool = create_edit_calendar_event_tool(deps)

    out = await _call_tool(tool, eventId="ev1")

    assert out["status"] == "error"
    assert out["code"] == "invalid_args"


@pytest.mark.asyncio
async def test_delete_calendar_event_calls_calendar_delete() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_calendar_client_factory(calls),
    )
    tool = create_delete_calendar_event_tool(deps)

    out = await _call_tool(tool, eventId="ev1")

    assert out == {"status": "ok", "deleted": {"id": "ev1", "calendarId": "primary"}}
    # Attendees are notified of the cancellation.
    assert calls == [("delete", {"calendarId": "primary", "eventId": "ev1", "sendUpdates": "all"})]


@pytest.mark.asyncio
async def test_edit_calendar_event_rejects_start_without_end() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_calendar_client_factory(calls),
    )
    tool = create_edit_calendar_event_tool(deps)

    out = await _call_tool(tool, eventId="ev1", start="2026-06-01T13:00:00Z")

    # Moving start without end would leave a stale end → reject, no API call.
    assert out["status"] == "error"
    assert out["code"] == "invalid_args"
    assert calls == []
