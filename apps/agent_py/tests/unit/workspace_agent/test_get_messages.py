"""Unit tests for the `get_messages` bulk Gmail read tool."""

from __future__ import annotations

import base64
from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.get_messages import create_get_messages_tool


class _FakeStore:
    def __init__(self) -> None:
        self.deletes: list[str] = []

    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        self.deletes.append(uid)


def _b64url(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def _message(mid: str, *, subject: str, body: str) -> dict[str, Any]:
    return {
        "id": mid,
        "threadId": f"t-{mid}",
        "snippet": body[:20],
        "payload": {
            "headers": [
                {"name": "From", "value": "sender@example.com"},
                {"name": "Subject", "value": subject},
                {"name": "Date", "value": "Fri, 29 May 2026 09:00:00 +0000"},
            ],
            "mimeType": "text/plain",
            "body": {"data": _b64url(body)},
        },
    }


def _build_client_factory(per_id_outcomes: dict[str, dict[str, Any]]) -> Any:
    class _Request:
        def __init__(self, outcome: dict[str, Any]) -> None:
            self._outcome = outcome

        def execute(self) -> Any:
            if self._outcome.get("raise"):
                raise self._outcome["raise"]
            return self._outcome.get("body", {})

    class _Messages:
        def get(self, *, userId: str, id: str, format: str) -> _Request:  # noqa: N803, A002
            outcome = per_id_outcomes.get(id)
            if outcome is None:
                raise AssertionError(f"unexpected id {id} in fake client")
            return _Request(outcome)

    class _Users:
        def messages(self) -> _Messages:
            return _Messages()

    class _Client:
        def users(self) -> _Users:
            return _Users()

    def _factory(service: str, access_token: str) -> Any:
        assert service == "gmail"
        assert access_token == "stub-token"
        return _Client()

    return _factory


def _make_http_error(status: int, message: str) -> Exception:
    class _Resp:
        def __init__(self, code: int) -> None:
            self.status = code

    err = Exception(message)
    err.resp = _Resp(status)  # type: ignore[attr-defined]
    return err


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


@pytest.mark.asyncio
async def test_get_messages_fetches_and_projects_messages_in_bulk() -> None:
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"body": _message("m1", subject="First", body="Please reply today")},
                "m2": {"body": _message("m2", subject="Second", body="Newsletter")},
            }
        ),
    )

    out = await _call_tool(create_get_messages_tool(deps), ids=["m1", "m2", "m1", " "])

    assert out["status"] == "ok"
    assert out["failed"] == []
    assert [m["id"] for m in out["messages"]] == ["m1", "m2"]
    assert out["messages"][0]["subject"] == "First"
    assert out["messages"][0]["body"] == "Please reply today"
    assert store.deletes == []


@pytest.mark.asyncio
async def test_get_messages_surfaces_scope_required_as_top_level_error() -> None:
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"body": _message("m1", subject="First", body="ok")},
                "m2": {"raise": _make_http_error(401, "auth failed")},
            }
        ),
    )

    out = await _call_tool(create_get_messages_tool(deps), ids=["m1", "m2"])

    assert out["status"] == "error"
    assert out["code"] == "scope_required"
    assert [m["id"] for m in out["messages"]] == ["m1"]
    assert out["failed"][0]["id"] == "m2"
    assert "u1" in store.deletes
