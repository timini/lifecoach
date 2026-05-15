"""Unit tests for `list_calendars` and calendar-list projection."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.projections import project_calendar_list_entry
from lifecoach_agent.workspace_agent.run_gws import RunGwsLogEvent
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.list_calendars import create_list_calendars_tool


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        raise AssertionError("delete should not be called on successful calendar listing")


class _Request:
    def __init__(self, response: Any) -> None:
        self._response = response

    def execute(self) -> Any:
        return self._response


class _CalendarList:
    def __init__(self, response: Any) -> None:
        self._response = response
        self.called = False

    def list(self) -> _Request:
        self.called = True
        return _Request(self._response)


class _CalendarService:
    def __init__(self, calendar_list: _CalendarList) -> None:
        self.calendar_list = calendar_list

    def calendarList(self) -> _CalendarList:  # noqa: N802 — Google API resource name
        return self.calendar_list


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


def test_project_calendar_list_entry_keeps_selection_metadata_only() -> None:
    proj = project_calendar_list_entry(
        {
            "id": "family@example.com",
            "summary": "Family",
            "primary": False,
            "accessRole": "writer",
            "timeZone": "Europe/London",
            "description": "Shared family events",
            "etag": "drop",
            "backgroundColor": "#000000",
        }
    )

    assert proj.model_dump(exclude_none=True) == {
        "id": "family@example.com",
        "summary": "Family",
        "primary": False,
        "accessRole": "writer",
        "timeZone": "Europe/London",
        "description": "Shared family events",
    }


@pytest.mark.asyncio
async def test_list_calendars_calls_calendar_list_endpoint_and_projects_response() -> None:
    response = {
        "items": [
            {
                "id": "primary@example.com",
                "summary": "Tim",
                "primary": True,
                "accessRole": "owner",
                "timeZone": "Europe/London",
            },
            {
                "id": "family-group@group.calendar.google.com",
                "summary": "Family",
                "accessRole": "writer",
                "timeZone": "Europe/London",
                "description": "Family calendar",
                "selected": True,
            },
        ]
    }
    calendar_list = _CalendarList(response)
    service = _CalendarService(calendar_list)

    def build_client(service_name: str, access_token: str) -> Any:
        assert service_name == "calendar"
        assert access_token == "stub-token"
        return service

    logs: list[RunGwsLogEvent] = []
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=build_client,
        log=logs.append,
    )
    out = await _call_tool(create_list_calendars_tool(deps))

    assert calendar_list.called is True
    assert logs == [
        RunGwsLogEvent(
            name="list_calendars",
            service="calendar",
            resource="calendarList",
            method="list",
            outcome="ok",
        )
    ]
    assert out == {
        "status": "ok",
        "calendars": [
            {
                "id": "primary@example.com",
                "summary": "Tim",
                "primary": True,
                "accessRole": "owner",
                "timeZone": "Europe/London",
            },
            {
                "id": "family-group@group.calendar.google.com",
                "summary": "Family",
                "primary": False,
                "accessRole": "writer",
                "timeZone": "Europe/London",
                "description": "Family calendar",
            },
        ],
    }
