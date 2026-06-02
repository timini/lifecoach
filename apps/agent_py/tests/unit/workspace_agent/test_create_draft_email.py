"""Unit tests for the Gmail draft creation tool."""

from __future__ import annotations

import base64
from email import message_from_bytes
from email.message import Message
from typing import Any

import pytest

from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.create_draft_email import (
    _build_raw_message,
    create_create_draft_email_tool,
)


class _FakeStore:
    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


class _Request:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body

    def execute(self) -> dict[str, Any]:
        return self._body


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


def _decode_raw(raw: str) -> Message:
    pad = (-len(raw)) % 4
    return message_from_bytes(base64.urlsafe_b64decode(raw + ("=" * pad)))


def test_build_raw_message_sets_reply_headers() -> None:
    raw = _build_raw_message(
        to=["ada@example.com"],
        subject="Re: Plan",
        body="Sounds good.",
        cc="grace@example.com",
        in_reply_to="<orig@example.com>",
        references="<orig@example.com>",
    )

    msg = _decode_raw(raw)
    assert msg["To"] == "ada@example.com"
    assert msg["Cc"] == "grace@example.com"
    assert msg["Subject"] == "Re: Plan"
    assert msg["In-Reply-To"] == "<orig@example.com>"
    assert msg["References"] == "<orig@example.com>"
    assert msg.get_payload(decode=True).decode("utf-8").strip() == "Sounds good."


@pytest.mark.asyncio
async def test_create_draft_email_calls_gmail_drafts_create() -> None:
    drafts = _Drafts()

    def build_client(service: str, access_token: str) -> Any:
        assert service == "gmail"
        assert access_token == "stub-token"
        return _Gmail(drafts)

    deps = WorkspaceToolDeps(
        store=_FakeStore(),  # type: ignore[arg-type]
        uid="u1",
        build_client=build_client,
    )
    tool = create_create_draft_email_tool(deps)

    out = await _call_tool(
        tool,
        to="ada@example.com",
        subject="Hello",
        body="Draft body",
        threadId="thr-1",
        inReplyTo="<orig@example.com>",
        references="<orig@example.com>",
    )

    assert out == {
        "status": "ok",
        "draft": {"id": "draft-1", "messageId": "msg-1", "threadId": "thr-1"},
    }
    assert drafts.last_kwargs is not None
    assert drafts.last_kwargs["userId"] == "me"
    request_body = drafts.last_kwargs["body"]
    assert request_body["message"]["threadId"] == "thr-1"
    msg = _decode_raw(request_body["message"]["raw"])
    assert msg["To"] == "ada@example.com"
    assert msg["Subject"] == "Hello"
    assert msg["In-Reply-To"] == "<orig@example.com>"
    assert msg.get_payload(decode=True).decode("utf-8").strip() == "Draft body"


@pytest.mark.asyncio
async def test_create_draft_email_requires_recipient_subject_and_body() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    tool = create_create_draft_email_tool(deps)

    out = await _call_tool(tool, to=[], subject="Hello", body="Body")
    assert out["status"] == "error"
    assert out["code"] == "invalid_args"

    out = await _call_tool(tool, to="ada@example.com", subject=" ", body="Body")
    assert out["status"] == "error"
    assert out["code"] == "invalid_args"

    out = await _call_tool(tool, to="ada@example.com", subject="Hello", body=" ")
    assert out["status"] == "error"
    assert out["code"] == "invalid_args"
