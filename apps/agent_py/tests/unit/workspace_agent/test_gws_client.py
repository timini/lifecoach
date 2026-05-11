"""Smoke tests for the gws_client dispatcher. The discovery client is
swapped out via `build_client` injection so tests don't hit Google."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.workspace_agent.gws_client import (
    CallWorkspaceErr,
    CallWorkspaceOk,
    _classify_http_error,
    _split_request_body,
    _walk_resource,
    call_workspace,
)

# --- helpers we exercise directly --------------------------------------


def test_split_request_body_extracts_request_body() -> None:
    rest, body = _split_request_body({"userId": "me", "requestBody": {"raw": "..."}})
    assert rest == {"userId": "me"}
    assert body == {"raw": "..."}


def test_split_request_body_returns_none_when_absent() -> None:
    rest, body = _split_request_body({"userId": "me"})
    assert rest == {"userId": "me"}
    assert body is None


def test_split_request_body_rejects_non_object_body() -> None:
    with pytest.raises(ValueError, match="requestBody"):
        _split_request_body({"requestBody": "not an object"})


def test_classify_http_error_codes() -> None:
    assert _classify_http_error(401, "invalid creds") == "scope_required"
    assert _classify_http_error(403, "Insufficient Scope") == "scope_required"
    assert _classify_http_error(403, "permission denied") == "forbidden"
    assert _classify_http_error(429, "rate limit") == "rate_limited"
    assert _classify_http_error(404, "not found") == "not_found"
    assert _classify_http_error(400, "bad request") == "bad_request"
    assert _classify_http_error(500, "internal") == "upstream"


# --- _walk_resource on a fake discovery client -------------------------


class _FakeRequest:
    def __init__(self, response: Any) -> None:
        self._response = response

    def execute(self) -> Any:
        return self._response


class _FakeMessages:
    def __init__(self, response: Any) -> None:
        self._response = response
        self.last_kwargs: dict[str, Any] | None = None

    def list(self, **kwargs: Any) -> _FakeRequest:
        self.last_kwargs = kwargs
        return _FakeRequest(self._response)


class _FakeUsers:
    def __init__(self, messages: _FakeMessages) -> None:
        self._messages = messages

    def messages(self) -> _FakeMessages:
        return self._messages


class _FakeGmailService:
    def __init__(self, response: Any) -> None:
        self._users = _FakeUsers(_FakeMessages(response))

    def users(self) -> _FakeUsers:
        return self._users


def test_walk_resource_navigates_dotted_path() -> None:
    svc = _FakeGmailService({"messages": []})
    obj = _walk_resource(svc, "users.messages")
    assert isinstance(obj, _FakeMessages)


def test_walk_resource_rejects_unknown_segment() -> None:
    svc = _FakeGmailService({})
    with pytest.raises(ValueError, match="unknown resource segment"):
        _walk_resource(svc, "users.bogus")


# --- end-to-end against an injected build_client -----------------------


@pytest.mark.asyncio
async def test_call_workspace_ok_path() -> None:
    expected = {"messages": [{"id": "abc"}]}
    fake = _FakeGmailService(expected)

    def build_client(_service: str, _token: str) -> Any:
        return fake

    result = await call_workspace(
        access_token="t",
        service="gmail",
        resource="users.messages",
        method="list",
        params='{"userId":"me","q":"label:INBOX"}',
        build_client=build_client,
    )
    assert isinstance(result, CallWorkspaceOk)
    assert result.body == expected
    # path/query fields propagated correctly.
    assert fake._users._messages.last_kwargs == {"userId": "me", "q": "label:INBOX"}


@pytest.mark.asyncio
async def test_call_workspace_invalid_service_returns_invalid_args() -> None:
    result = await call_workspace(
        access_token="t",
        service="drive",  # not in WORKSPACE_SERVICES
        resource="files",
        method="list",
        build_client=lambda *_a, **_kw: None,
    )
    assert isinstance(result, CallWorkspaceErr)
    assert result.code == "invalid_args"


@pytest.mark.asyncio
async def test_call_workspace_invalid_json_params() -> None:
    result = await call_workspace(
        access_token="t",
        service="gmail",
        resource="users.messages",
        method="list",
        params="not-json",
        build_client=lambda *_a, **_kw: None,
    )
    assert isinstance(result, CallWorkspaceErr)
    assert result.code == "invalid_args"


@pytest.mark.asyncio
async def test_call_workspace_split_request_body() -> None:
    """archive (modify) — `requestBody` must split off from path/query."""
    fake = _FakeGmailService({"id": "m1", "labelIds": ["UNREAD"]})

    def build_client(_service: str, _token: str) -> Any:
        return fake

    # Override the fake `list` to be a `modify` for this test by aliasing.
    fake._users._messages.modify = fake._users._messages.list  # type: ignore[attr-defined]

    result = await call_workspace(
        access_token="t",
        service="gmail",
        resource="users.messages",
        method="modify",
        params='{"userId":"me","id":"m1","requestBody":{"removeLabelIds":["INBOX"]}}',
        build_client=build_client,
    )
    assert isinstance(result, CallWorkspaceOk)
    kwargs = fake._users._messages.last_kwargs
    assert kwargs is not None
    assert kwargs["userId"] == "me"
    assert kwargs["id"] == "m1"
    assert kwargs["body"] == {"removeLabelIds": ["INBOX"]}
