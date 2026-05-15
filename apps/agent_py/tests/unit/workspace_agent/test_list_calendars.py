"""Unit tests for the `list_calendars` read tool."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.agent import _build_read_tools
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.list_calendars import create_list_calendars_tool


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


class _Request:
    def execute(self) -> dict[str, Any]:
        return {
            "kind": "calendar#calendarList",
            "etag": "drop-list-etag",
            "items": [
                {
                    "kind": "calendar#calendarListEntry",
                    "etag": "drop-entry-etag",
                    "id": "primary@example.com",
                    "summary": "Personal",
                    "primary": True,
                    "accessRole": "owner",
                    "timeZone": "Europe/London",
                    "backgroundColor": "#abcdef",
                },
                {
                    "id": "family_123@group.calendar.google.com",
                    "summary": "Family",
                    "description": "Shared family calendar",
                    "accessRole": "writer",
                    "timeZone": "Europe/London",
                    "selected": True,
                },
            ],
        }


class _CalendarList:
    def list(self) -> _Request:
        return _Request()


class _CalendarClient:
    def calendarList(self) -> _CalendarList:  # noqa: N802
        return _CalendarList()


def _build_client(service: str, access_token: str) -> Any:
    assert service == "calendar"
    assert access_token == "stub-token"
    return _CalendarClient()


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


@pytest.mark.asyncio
async def test_list_calendars_calls_calendar_list_and_projects_minimum_fields() -> None:
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client,
    )

    out = await _call_tool(create_list_calendars_tool(deps))

    assert out == {
        "status": "ok",
        "calendars": [
            {
                "id": "primary@example.com",
                "summary": "Personal",
                "primary": True,
                "accessRole": "owner",
                "timeZone": "Europe/London",
            },
            {
                "id": "family_123@group.calendar.google.com",
                "summary": "Family",
                "primary": False,
                "accessRole": "writer",
                "timeZone": "Europe/London",
                "description": "Shared family calendar",
            },
        ],
    }


@pytest.mark.asyncio
async def test_read_tool_set_includes_list_calendars() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]

    names = {getattr(tool, "name", None) for tool in _build_read_tools(deps)}

    assert "list_calendars" in names
