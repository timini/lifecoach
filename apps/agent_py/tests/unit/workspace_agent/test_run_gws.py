"""Unit tests for `run_gws` — the auth + dispatch + classify + log
helper every workspace tool routes through.

Critical contract: on `scope_required` from a `call_workspace` result,
the helper MUST delete the user's token doc so the next turn demotes
back to `google_linked`. If this branch ever drifts, every workspace
tool silently leaves the user stuck. Other error codes (network,
not_found, etc.) must NOT delete the doc.
"""

from __future__ import annotations

from typing import Any

import pytest

import sys

from lifecoach_agent.storage.workspace_tokens import ScopeRequiredError
from lifecoach_agent.workspace_agent import gws_client
from lifecoach_agent.workspace_agent.run_gws import (
    RunGwsErr,
    RunGwsLogEvent,
    RunGwsOk,
    run_gws,
)

# `workspace_agent/__init__.py` re-exports `run_gws` (the function) as a
# package attribute, which shadows the submodule for normal attribute
# access. Grab the real submodule via `sys.modules` so monkeypatch can
# rebind `call_workspace` inside it.
_RUN_GWS_MODULE = sys.modules["lifecoach_agent.workspace_agent.run_gws"]


class _FakeStore:
    def __init__(self, raise_on_get: Exception | None = None) -> None:
        self._raise = raise_on_get
        self.deletes: list[str] = []

    async def get_valid_access_token(self, uid: str) -> str:
        if self._raise is not None:
            raise self._raise
        return "stub-token"

    async def delete(self, uid: str) -> None:
        self.deletes.append(uid)


def _patch_call_workspace(monkeypatch: pytest.MonkeyPatch, result: Any) -> list[dict]:
    """Replace `call_workspace` with a coroutine that returns `result`.
    Returns a list that captures each call's kwargs for assertions.

    `run_gws.py` did `from ...gws_client import call_workspace`, so the
    bound name to patch is the `call_workspace` symbol inside the
    `lifecoach_agent.workspace_agent.run_gws` module — patching only
    `gws_client.call_workspace` would leave the in-module reference
    pointing at the original."""
    calls: list[dict] = []

    async def fake(**kwargs: Any) -> Any:
        calls.append(kwargs)
        return result

    monkeypatch.setattr(gws_client, "call_workspace", fake)
    monkeypatch.setattr(_RUN_GWS_MODULE, "call_workspace", fake)
    return calls


@pytest.mark.asyncio
async def test_scope_required_from_store_returns_err_without_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ScopeRequiredError raised by the store itself happens BEFORE the
    dispatch path. `run_gws` returns the structured error and the log
    fires with outcome='scope_required', but it does NOT call
    `store.delete` (the store has already cleaned itself up — refresh
    failures inside `get_valid_access_token` do that)."""
    store = _FakeStore(raise_on_get=ScopeRequiredError())
    events: list[RunGwsLogEvent] = []
    result = await run_gws(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        tool_name="list_inbox",
        service="gmail",
        resource="users.messages",
        method="list",
        log=events.append,
    )
    assert isinstance(result, RunGwsErr)
    assert result.code == "scope_required"
    assert store.deletes == []  # store-level error, store self-cleaned
    assert events[0].outcome == "scope_required"
    assert events[0].name == "list_inbox"


@pytest.mark.asyncio
async def test_call_workspace_scope_required_triggers_store_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When `call_workspace` itself returns CallWorkspaceErr with
    scope_required, run_gws MUST delete the user's token doc so the
    next turn drops to google_linked. This is the load-bearing branch
    Reviews 1 and 3 flagged as untested."""
    _patch_call_workspace(
        monkeypatch,
        gws_client.CallWorkspaceErr(
            status="error", code="scope_required", message="scope X required"
        ),
    )
    store = _FakeStore()
    events: list[RunGwsLogEvent] = []
    result = await run_gws(
        store=store,  # type: ignore[arg-type]
        uid="u-target",
        tool_name="archive_messages",
        service="gmail",
        resource="users.messages",
        method="modify",
        log=events.append,
    )
    assert isinstance(result, RunGwsErr)
    assert result.code == "scope_required"
    assert store.deletes == ["u-target"]
    assert events[0].outcome == "scope_required"


@pytest.mark.asyncio
async def test_non_auth_errors_do_not_delete_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-auth failures (network, rate_limited, not_found, etc.) MUST
    NOT delete the user's token. The connection is fine; the request
    just failed transiently or the resource is missing."""
    for code in ("network", "rate_limited", "not_found", "bad_request", "upstream"):
        _patch_call_workspace(
            monkeypatch,
            gws_client.CallWorkspaceErr(status="error", code=code, message=f"{code} happened"),
        )
        store = _FakeStore()
        result = await run_gws(
            store=store,  # type: ignore[arg-type]
            uid="u1",
            tool_name="list_inbox",
            service="gmail",
            resource="users.messages",
            method="list",
        )
        assert isinstance(result, RunGwsErr), code
        assert result.code == code
        assert store.deletes == [], f"{code} must not delete the token"


@pytest.mark.asyncio
async def test_ok_path_returns_body_and_logs_ok(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_call_workspace(
        monkeypatch,
        gws_client.CallWorkspaceOk(status="ok", body={"messages": []}, truncated=False),
    )
    store = _FakeStore()
    events: list[RunGwsLogEvent] = []
    result = await run_gws(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        tool_name="list_inbox",
        service="gmail",
        resource="users.messages",
        method="list",
        log=events.append,
    )
    assert isinstance(result, RunGwsOk)
    assert result.body == {"messages": []}
    assert result.truncated is False
    assert events[0].outcome == "ok"


@pytest.mark.asyncio
async def test_body_splits_into_requestBody_for_call_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies the body→requestBody nesting that the gws_client
    splitter expects. `run_gws(body=...)` must surface as `params`
    JSON containing `requestBody`."""
    calls = _patch_call_workspace(
        monkeypatch,
        gws_client.CallWorkspaceOk(status="ok", body={}, truncated=False),
    )
    store = _FakeStore()
    await run_gws(
        store=store,  # type: ignore[arg-type]
        uid="u1",
        tool_name="archive_messages",
        service="gmail",
        resource="users.messages",
        method="modify",
        params={"userId": "me", "id": "m1"},
        body={"removeLabelIds": ["INBOX"]},
    )
    assert len(calls) == 1
    # `call_workspace` receives params as a JSON-encoded string.
    import json

    params = json.loads(calls[0]["params"])
    assert params == {
        "userId": "me",
        "id": "m1",
        "requestBody": {"removeLabelIds": ["INBOX"]},
    }
