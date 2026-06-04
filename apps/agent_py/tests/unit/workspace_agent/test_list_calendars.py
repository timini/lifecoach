"""Unit tests for the `list_calendars` read tool.

Covers issue #130 and the Codex review feedback the original PRs missed:
- projects only the minimum user-facing fields,
- follows `nextPageToken` so large accounts aren't cut off at page one,
- requests small pages and surfaces `truncated` instead of silently
  returning an empty list when a page is clipped by the run_gws cap.
"""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.agent import _build_read_tools
from lifecoach_agent.workspace_agent.run_gws import RunGwsErr, RunGwsOk
from lifecoach_agent.workspace_agent.tools import list_calendars as list_calendars_module
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.list_calendars import (
    _PAGE_SIZE,
    create_list_calendars_tool,
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


def _deps() -> WorkspaceToolDeps:
    return WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]


_PERSONAL = {
    "kind": "calendar#calendarListEntry",
    "etag": "drop-entry-etag",
    "id": "primary@example.com",
    "summary": "Personal",
    "primary": True,
    "accessRole": "owner",
    "timeZone": "Europe/London",
    "backgroundColor": "#abcdef",
}
_FAMILY = {
    "id": "family_123@group.calendar.google.com",
    "summary": "Family",
    "description": "Shared family calendar",
    "accessRole": "writer",
    "timeZone": "Europe/London",
    "selected": True,
}

_PROJECTED_PERSONAL = {
    "id": "primary@example.com",
    "summary": "Personal",
    "primary": True,
    "accessRole": "owner",
    "timeZone": "Europe/London",
}
_PROJECTED_FAMILY = {
    "id": "family_123@group.calendar.google.com",
    "summary": "Family",
    "primary": False,
    "accessRole": "writer",
    "timeZone": "Europe/London",
    "description": "Shared family calendar",
}


@pytest.mark.asyncio
async def test_list_calendars_projects_minimum_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        calls.append(kwargs)
        return RunGwsOk(body={"items": [_PERSONAL, _FAMILY]})

    monkeypatch.setattr(list_calendars_module, "run_gws", fake_run_gws)

    out = await _call_tool(create_list_calendars_tool(_deps()))

    assert out == {"status": "ok", "calendars": [_PROJECTED_PERSONAL, _PROJECTED_FAMILY]}
    # One page, requested with a conservative maxResults and no pageToken.
    assert len(calls) == 1
    assert calls[0]["service"] == "calendar"
    assert calls[0]["resource"] == "calendarList"
    assert calls[0]["params"] == {"maxResults": _PAGE_SIZE}


@pytest.mark.asyncio
async def test_list_calendars_follows_next_page_token(monkeypatch: pytest.MonkeyPatch) -> None:
    pages = [
        {"items": [_PERSONAL], "nextPageToken": "tok-2"},
        {"items": [_FAMILY]},  # no token → last page
    ]
    calls: list[dict[str, Any]] = []

    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        calls.append(kwargs)
        return RunGwsOk(body=pages[len(calls) - 1])

    monkeypatch.setattr(list_calendars_module, "run_gws", fake_run_gws)

    out = await _call_tool(create_list_calendars_tool(_deps()))

    # Both pages merged — the family calendar on page two is NOT lost.
    assert out == {"status": "ok", "calendars": [_PROJECTED_PERSONAL, _PROJECTED_FAMILY]}
    assert len(calls) == 2
    assert "pageToken" not in calls[0]["params"]
    assert calls[1]["params"]["pageToken"] == "tok-2"


@pytest.mark.asyncio
async def test_list_calendars_dedupes_ids_across_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    pages = [
        {"items": [_PERSONAL, _FAMILY], "nextPageToken": "tok-2"},
        {"items": [_FAMILY]},  # overlap with page one
    ]
    calls: list[int] = []

    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        calls.append(1)
        return RunGwsOk(body=pages[len(calls) - 1])

    monkeypatch.setattr(list_calendars_module, "run_gws", fake_run_gws)

    out = await _call_tool(create_list_calendars_tool(_deps()))

    assert [c["id"] for c in out["calendars"]] == [
        "primary@example.com",
        "family_123@group.calendar.google.com",
    ]


@pytest.mark.asyncio
async def test_list_calendars_surfaces_truncation(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_run_gws(**kwargs: Any) -> RunGwsOk:
        return RunGwsOk(body={"items": [_PERSONAL]}, truncated=True)

    monkeypatch.setattr(list_calendars_module, "run_gws", fake_run_gws)

    out = await _call_tool(create_list_calendars_tool(_deps()))

    # A clipped page is flagged, not silently reported as the whole list.
    assert out["status"] == "ok"
    assert out["truncated"] is True
    assert [c["id"] for c in out["calendars"]] == ["primary@example.com"]


@pytest.mark.asyncio
async def test_list_calendars_propagates_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_run_gws(**kwargs: Any) -> RunGwsErr:
        return RunGwsErr(status="error", code="scope_required", message="reconnect")

    monkeypatch.setattr(list_calendars_module, "run_gws", fake_run_gws)

    out = await _call_tool(create_list_calendars_tool(_deps()))

    assert out == {"status": "error", "code": "scope_required", "message": "reconnect"}


@pytest.mark.asyncio
async def test_read_tool_set_includes_list_calendars() -> None:
    names = {getattr(tool, "name", None) for tool in _build_read_tools(_deps())}
    assert "list_calendars" in names
