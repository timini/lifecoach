"""Unit tests for `bulk_fetch_email`."""

from __future__ import annotations

import base64
from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.bulk_fetch_email import create_bulk_fetch_email_tool


def _b64url(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).rstrip(b"=").decode("ascii")


class _FakeStore:
    def __init__(self) -> None:
        self.deletes: list[str] = []

    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        self.deletes.append(uid)


def _message(mid: str, subject: str, body: str) -> dict[str, Any]:
    return {
        "id": mid,
        "threadId": f"thread-{mid}",
        "snippet": body[:20],
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": "Alice <alice@example.com>"},
                {"name": "Subject", "value": subject},
            ],
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
        def get(self, *, userId: str, id: str, format: str = "full") -> _Request:  # noqa: N803,A002
            assert userId == "me"
            assert format in {"full", "metadata"}
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
async def test_bulk_fetch_email_returns_projected_messages_in_input_order() -> None:
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"body": _message("m1", "First", "first body")},
                "m2": {"body": _message("m2", "Second", "second body")},
            }
        ),
    )

    out = await _call_tool(create_bulk_fetch_email_tool(deps), ids=["m1", "m2"])

    assert out["status"] == "ok"
    assert out["failed"] == []
    assert [message["id"] for message in out["messages"]] == ["m1", "m2"]
    assert out["messages"][0]["subject"] == "First"
    assert out["messages"][1]["body"] == "second body"


@pytest.mark.asyncio
async def test_bulk_fetch_email_keeps_non_auth_failures_per_id() -> None:
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"body": _message("m1", "First", "first body")},
                "missing": {"raise": _make_http_error(404, "not found")},
            }
        ),
    )

    out = await _call_tool(create_bulk_fetch_email_tool(deps), ids=["m1", "missing"])

    assert out["status"] == "ok"
    assert [message["id"] for message in out["messages"]] == ["m1"]
    assert out["failed"] == [{"id": "missing", "code": "not_found", "message": "not found"}]
    assert store.deletes == []


@pytest.mark.asyncio
async def test_bulk_fetch_email_surfaces_scope_required_top_level() -> None:
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"body": _message("m1", "First", "first body")},
                "auth": {"raise": _make_http_error(401, "auth failed")},
            }
        ),
    )

    out = await _call_tool(create_bulk_fetch_email_tool(deps), ids=["m1", "auth"])

    assert out["status"] == "error"
    assert out["code"] == "scope_required"
    assert "u1" in store.deletes
