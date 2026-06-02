"""Unit tests for `draft_email`."""

from __future__ import annotations

import base64
from email import policy
from email.parser import BytesParser
from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.draft_email import (
    _encode_rfc2822_message,
    create_draft_email_tool,
)


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        raise AssertionError("delete should not be called on success")


class _Request:
    def __init__(self, response: dict[str, Any]) -> None:
        self._response = response

    def execute(self) -> dict[str, Any]:
        return self._response


class _Drafts:
    def __init__(self) -> None:
        self.last_kwargs: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> _Request:
        self.last_kwargs = kwargs
        return _Request({"id": "draft-1", "message": {"id": "msg-1", "threadId": "thr-1"}})


class _Users:
    def __init__(self, drafts: _Drafts) -> None:
        self._drafts = drafts

    def drafts(self) -> _Drafts:
        return self._drafts


class _Gmail:
    def __init__(self, drafts: _Drafts) -> None:
        self._users = _Users(drafts)

    def users(self) -> _Users:
        return self._users


async def _call_tool(tool: Any, **kwargs: Any) -> Any:
    func = getattr(tool, "func", None) or getattr(tool, "_func", None)
    assert func is not None, "couldn't find underlying callable on FunctionTool"
    return await func(**kwargs)


def _decode_raw(raw: str) -> Any:
    return BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(raw))


def test_encode_rfc2822_message_includes_headers_and_plain_body() -> None:
    raw = _encode_rfc2822_message(
        to=["a@example.com", "b@example.com"],
        cc=["c@example.com"],
        subject="Project update",
        body="Hello team,\n\nQuick update.",
        reply_to="me@example.com",
        in_reply_to="<old@example.com>",
        references="<old@example.com>",
    )

    parsed = _decode_raw(raw)
    assert parsed["To"] == "a@example.com, b@example.com"
    assert parsed["Cc"] == "c@example.com"
    assert parsed["Subject"] == "Project update"
    assert parsed["Reply-To"] == "me@example.com"
    assert parsed["In-Reply-To"] == "<old@example.com>"
    assert parsed["References"] == "<old@example.com>"
    assert parsed.get_content().replace("\r\n", "\n") == "Hello team,\n\nQuick update.\n"


@pytest.mark.asyncio
async def test_draft_email_calls_gmail_drafts_create_with_encoded_message() -> None:
    drafts = _Drafts()

    def build_client(service: str, access_token: str) -> Any:
        assert service == "gmail"
        assert access_token == "stub-token"
        return _Gmail(drafts)

    tool = create_draft_email_tool(
        WorkspaceToolDeps(
            store=_FakeStore(),  # type: ignore[arg-type]
            uid="u1",
            build_client=build_client,
        )
    )

    out = await _call_tool(
        tool,
        to=["friend@example.com"],
        subject="Hello",
        body="Draft body",
        threadId="thr-1",
    )

    assert out == {
        "status": "ok",
        "draftId": "draft-1",
        "messageId": "msg-1",
        "threadId": "thr-1",
    }
    assert drafts.last_kwargs is not None
    assert drafts.last_kwargs["userId"] == "me"
    request_body = drafts.last_kwargs["body"]
    assert request_body["message"]["threadId"] == "thr-1"
    parsed = _decode_raw(request_body["message"]["raw"])
    assert parsed["To"] == "friend@example.com"
    assert parsed["Subject"] == "Hello"
    assert parsed.get_content().replace("\r\n", "\n") == "Draft body\n"
