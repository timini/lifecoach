"""Unit tests for ``list_calendars``."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.list_calendars import create_list_calendars_tool


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        raise AssertionError("delete should not be called on success")


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


def _build_calendar_client_factory(response: dict[str, Any]) -> Any:
    class _Request:
        def execute(self) -> Any:
            return response

    class _CalendarList:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def list(self, **kwargs: Any) -> _Request:
            self.calls.append(kwargs)
            return _Request()

    calendar_list = _CalendarList()

    class _Client:
        def calendarList(self) -> _CalendarList:  # noqa: N802 - Google API resource name
            return calendar_list

    def _factory(service: str, access_token: str) -> Any:
        assert service == "calendar"
        assert access_token == "stub-token"
        client = _Client()
        client.calendar_list = calendar_list  # type: ignore[attr-defined]
        return client

    _factory.calendar_list = calendar_list  # type: ignore[attr-defined]
    return _factory


@pytest.mark.asyncio
async def test_list_calendars_calls_calendar_list_and_projects_minimum_fields() -> None:
    build_client = _build_calendar_client_factory(
        {
            "items": [
                {
                    "id": "primary@example.com",
                    "summary": "Alex",
                    "primary": True,
                    "accessRole": "owner",
                    "timeZone": "Europe/London",
                    "etag": "drop-me",
                },
                {
                    "id": "family-123@group.calendar.google.com",
                    "summary": "Family",
                    "description": "Shared family plans",
                    "accessRole": "writer",
                    "timeZone": "Europe/London",
                    "backgroundColor": "#ff0000",
                },
            ]
        }
    )
    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=build_client,
    )

    out = await _call_tool(create_list_calendars_tool(deps))

    assert out == {
        "status": "ok",
        "calendars": [
            {
                "id": "primary@example.com",
                "summary": "Alex",
                "primary": True,
                "accessRole": "owner",
                "timeZone": "Europe/London",
            },
            {
                "id": "family-123@group.calendar.google.com",
                "summary": "Family",
                "primary": False,
                "accessRole": "writer",
                "timeZone": "Europe/London",
                "description": "Shared family plans",
            },
        ],
    }
    assert build_client.calendar_list.calls == [{"maxResults": 250}]  # type: ignore[attr-defined]
