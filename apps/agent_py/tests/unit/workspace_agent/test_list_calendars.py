"""Unit tests for ``list_calendars``.

Locks the issue #130 contract: listing calendar IDs must call Google
Calendar's ``calendarList.list`` endpoint and return only the projected
selection metadata, not raw Calendar API payloads.
"""

from __future__ import annotations

from typing import Any

import pytest

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
            "items": [
                {
                    "id": "primary@example.com",
                    "summary": "Tim",
                    "primary": True,
                    "accessRole": "owner",
                    "timeZone": "America/New_York",
                    "etag": "drop-me",
                },
                {
                    "id": "family-123@group.calendar.google.com",
                    "summary": "Family",
                    "accessRole": "writer",
                    "timeZone": "America/New_York",
                    "description": "Shared family plans",
                    "notificationSettings": {"notifications": []},
                },
            ]
        }


class _CalendarList:
    def __init__(self) -> None:
        self.called = False

    def list(self) -> _Request:
        self.called = True
        return _Request()


class _CalendarClient:
    def __init__(self) -> None:
        self.calendar_list = _CalendarList()

    def calendarList(self) -> _CalendarList:  # noqa: N802 — discovery resource name
        return self.calendar_list


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


@pytest.mark.asyncio
async def test_list_calendars_calls_calendar_list_and_projects_fields() -> None:
    fake = _CalendarClient()

    def build_client(service: str, access_token: str) -> Any:
        assert service == "calendar"
        assert access_token == "stub-token"
        return fake

    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=build_client,
    )
    out = await _call_tool(create_list_calendars_tool(deps))

    assert fake.calendar_list.called is True
    assert out == {
        "status": "ok",
        "calendars": [
            {
                "id": "primary@example.com",
                "summary": "Tim",
                "primary": True,
                "accessRole": "owner",
                "timeZone": "America/New_York",
            },
            {
                "id": "family-123@group.calendar.google.com",
                "summary": "Family",
                "primary": False,
                "accessRole": "writer",
                "timeZone": "America/New_York",
                "description": "Shared family plans",
            },
        ],
    }
