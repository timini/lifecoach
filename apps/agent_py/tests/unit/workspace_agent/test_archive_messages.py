"""Unit tests for `archive_messages` — focus on the scope_required
handling that bit us in code review.

`run_gws` deletes the user's token doc the moment any single call
returns scope_required. That means once *any* id in a batch fails with
scope_required, the connection is gone for the entire turn (and every
future call until the user reconnects). The tool MUST therefore
surface a top-level `scope_required` error to the LLM whenever any
failure has that code — not only when failed[0] does, and not only
when *every* id failed.
"""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.archive_messages import (
    create_archive_messages_tool,
)


class _FakeStore:
    """Tracks `get_valid_access_token` + `delete` calls so a test can
    assert both that the token resolves and that the doc-delete path
    fired when scope_required surfaced."""

    def __init__(self) -> None:
        self.deletes: list[str] = []

    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        self.deletes.append(uid)


def _build_client_factory(per_id_outcomes: dict[str, dict[str, Any]]) -> Any:
    """Build a fake `build_client` callable that the workspace client
    will use. Each Gmail `users.messages.modify` request looks up the
    `id` it was given and returns the canned outcome, mimicking the
    discovery client's `.execute()` semantics."""

    class _Request:
        def __init__(self, outcome: dict[str, Any]) -> None:
            self._outcome = outcome

        def execute(self) -> Any:
            if self._outcome.get("raise"):
                raise self._outcome["raise"]
            return self._outcome.get("body", {})

    class _Messages:
        def modify(self, *, userId: str, id: str, body: Any = None) -> _Request:  # noqa: N803
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
        return _Client()

    return _factory


def _make_http_error(status: int, message: str) -> Exception:
    """Build an exception that mimics `googleapiclient.errors.HttpError`
    enough for `_classify_http_error` in `gws_client` to read the
    status off."""

    class _Resp:
        def __init__(self, code: int) -> None:
            self.status = code

    err = Exception(message)
    err.resp = _Resp(status)  # type: ignore[attr-defined]
    return err


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    """Invoke the ADK `FunctionTool` by unwrapping its underlying
    callable. Avoids spinning up a real ToolContext just for a unit."""
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


@pytest.mark.asyncio
async def test_all_ok_returns_archived_empty_failed() -> None:
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {"m1": {"body": {}}, "m2": {"body": {}}}
        ),
    )
    tool = create_archive_messages_tool(deps)
    out = await _call_tool(tool, ids=["m1", "m2"])
    assert out == {"status": "ok", "archived": ["m1", "m2"], "failed": []}
    assert store.deletes == []


@pytest.mark.asyncio
async def test_scope_required_anywhere_in_failures_surfaces_top_level_error() -> None:
    """The bug review caught: failed[0] check missed cases where some
    ids succeed first and the scope_required failure is later in the
    batch. Token doc has already been deleted by run_gws at that point;
    the LLM must see the top-level scope_required to reconnect."""
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"body": {}},  # succeeds
                "m2": {"body": {}},  # succeeds
                "m3": {"raise": _make_http_error(401, "auth failed")},  # scope_required
            }
        ),
    )
    tool = create_archive_messages_tool(deps)
    out = await _call_tool(tool, ids=["m1", "m2", "m3"])
    assert out["status"] == "error"
    assert out["code"] == "scope_required"
    # run_gws deletes on any scope_required outcome — the doc was indeed
    # torn down. Idempotent if called multiple times for the same uid.
    assert "u1" in store.deletes


@pytest.mark.asyncio
async def test_scope_required_buried_after_other_failure_codes_still_surfaces() -> None:
    """failed[0]['code'] would be 'not_found' here — the broken check
    would have missed scope_required entirely and returned status:ok."""
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"raise": _make_http_error(404, "not found")},  # not_found
                "m2": {"raise": _make_http_error(401, "auth failed")},  # scope_required
            }
        ),
    )
    tool = create_archive_messages_tool(deps)
    out = await _call_tool(tool, ids=["m1", "m2"])
    assert out["status"] == "error"
    assert out["code"] == "scope_required"


@pytest.mark.asyncio
async def test_non_auth_failures_keep_status_ok_with_per_id_failed_entries() -> None:
    """Non-auth failures (not_found, rate_limited, etc.) stay in
    failed[] under status:ok — the LLM can surface those to the user
    without triggering a reconnect."""
    store = _FakeStore()
    deps = WorkspaceToolDeps(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        build_client=_build_client_factory(
            {
                "m1": {"body": {}},
                "m2": {"raise": _make_http_error(404, "not found")},
            }
        ),
    )
    tool = create_archive_messages_tool(deps)
    out = await _call_tool(tool, ids=["m1", "m2"])
    assert out["status"] == "ok"
    assert out["archived"] == ["m1"]
    assert len(out["failed"]) == 1
    assert out["failed"][0]["id"] == "m2"
    assert out["failed"][0]["code"] == "not_found"
    assert store.deletes == []


@pytest.mark.asyncio
async def test_empty_ids_returns_ok_with_empty_arrays() -> None:
    store = _FakeStore()
    deps = WorkspaceToolDeps(store=store, uid="u1")  # type: ignore[arg-type]
    tool = create_archive_messages_tool(deps)
    out = await _call_tool(tool, ids=[])
    assert out == {"status": "ok", "archived": [], "failed": []}
