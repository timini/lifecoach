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


class _Threads:
    """Fake gmail.users().threads(). `message_id` is the Message-Id header
    returned for the thread's last message; None simulates a lookup that
    finds no header. `fail` simulates the API call erroring."""

    def __init__(self, message_id: str | None = None, *, fail: bool = False) -> None:
        self.message_id = message_id
        self.fail = fail
        self.get_kwargs: dict[str, Any] | None = None

    def get(self, **kwargs: Any) -> _Request:
        self.get_kwargs = kwargs
        if self.fail:
            raise RuntimeError("thread fetch failed")
        headers = [{"name": "Message-Id", "value": self.message_id}] if self.message_id else []
        return _Request({"messages": [{"payload": {"headers": headers}}]})


class _Users:
    def __init__(self, drafts: _Drafts, threads: _Threads | None = None) -> None:
        self._drafts = drafts
        self._threads = threads or _Threads()

    def drafts(self) -> _Drafts:
        return self._drafts

    def threads(self) -> _Threads:
        return self._threads


class _Gmail:
    def __init__(self, drafts: _Drafts, threads: _Threads | None = None) -> None:
        self._users = _Users(drafts, threads)

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
        inReplyTo="<orig@example.com>",
        references="<orig@example.com>",
    )

    assert out == {
        "status": "ok",
        "draftId": "draft-1",
        "messageId": "msg-1",
        "threadId": "thr-1",
        "url": "https://mail.google.com/mail/u/0/#drafts?compose=msg-1",
    }
    assert drafts.last_kwargs is not None
    assert drafts.last_kwargs["userId"] == "me"
    request_body = drafts.last_kwargs["body"]
    assert request_body["message"]["threadId"] == "thr-1"
    parsed = _decode_raw(request_body["message"]["raw"])
    assert parsed["To"] == "friend@example.com"
    assert parsed["Subject"] == "Hello"
    assert parsed["In-Reply-To"] == "<orig@example.com>"
    assert parsed.get_content().replace("\r\n", "\n") == "Draft body\n"


@pytest.mark.asyncio
async def test_draft_email_threadid_only_derives_reply_headers_from_thread() -> None:
    """A reply with only threadId (the common triage case) must thread —
    the tool fetches the thread's last Message-Id and sets In-Reply-To /
    References itself, instead of rejecting and starting a new thread."""
    drafts = _Drafts()
    threads = _Threads(message_id="<orig-123@mail.example>")

    def build_client(service: str, access_token: str) -> Any:
        return _Gmail(drafts, threads)

    tool = create_draft_email_tool(
        WorkspaceToolDeps(
            store=_FakeStore(),  # type: ignore[arg-type]
            uid="u1",
            build_client=build_client,
        )
    )

    out = await _call_tool(
        tool, to=["friend@example.com"], subject="Re: Hi", body="reply", threadId="thr-1"
    )

    assert out["status"] == "ok"
    assert out["url"] == "https://mail.google.com/mail/u/0/#drafts?compose=msg-1"
    # Looked up the right thread.
    assert threads.get_kwargs is not None and threads.get_kwargs["id"] == "thr-1"
    # Draft attached to the thread AND carries derived reply headers.
    request_body = drafts.last_kwargs["body"]
    assert request_body["message"]["threadId"] == "thr-1"
    parsed = _decode_raw(request_body["message"]["raw"])
    assert parsed["In-Reply-To"] == "<orig-123@mail.example>"
    assert parsed["References"] == "<orig-123@mail.example>"


@pytest.mark.asyncio
async def test_draft_email_threadid_only_still_drafts_when_thread_lookup_fails() -> None:
    """If the thread lookup errors, still create the draft (Gmail attaches
    it to the thread via threadId) — never block on the header derivation."""
    drafts = _Drafts()
    threads = _Threads(fail=True)

    def build_client(service: str, access_token: str) -> Any:
        return _Gmail(drafts, threads)

    tool = create_draft_email_tool(
        WorkspaceToolDeps(
            store=_FakeStore(),  # type: ignore[arg-type]
            uid="u1",
            build_client=build_client,
        )
    )

    out = await _call_tool(
        tool, to=["friend@example.com"], subject="Re: Hi", body="reply", threadId="thr-1"
    )

    assert out["status"] == "ok"
    request_body = drafts.last_kwargs["body"]
    assert request_body["message"]["threadId"] == "thr-1"
    parsed = _decode_raw(request_body["message"]["raw"])
    assert parsed["In-Reply-To"] is None  # no header derived, but draft still made


@pytest.mark.asyncio
async def test_draft_email_synthesises_references_from_in_reply_to() -> None:
    drafts = _Drafts()

    def build_client(service: str, access_token: str) -> Any:
        return _Gmail(drafts)

    tool = create_draft_email_tool(
        WorkspaceToolDeps(
            store=_FakeStore(),  # type: ignore[arg-type]
            uid="u1",
            build_client=build_client,
        )
    )

    # Caller passes only the Message-ID; References must be synthesised so
    # Gmail gets both threading headers, not just one.
    out = await _call_tool(
        tool,
        to=["friend@example.com"],
        subject="Re: Hi",
        body="reply",
        threadId="thr-1",
        inReplyTo="<orig@example.com>",
    )

    assert out["status"] == "ok"
    assert drafts.last_kwargs is not None
    parsed = _decode_raw(drafts.last_kwargs["body"]["message"]["raw"])
    assert parsed["In-Reply-To"] == "<orig@example.com>"
    assert parsed["References"] == "<orig@example.com>"


@pytest.mark.asyncio
async def test_draft_email_rejects_header_injection() -> None:
    drafts = _Drafts()

    def build_client(service: str, access_token: str) -> Any:
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
        subject="Hello\nBcc: victim@example.com",
        body="Draft body",
    )

    # A newline in the subject would smuggle an extra header → reject, no call.
    assert out["status"] == "error"
    assert out["code"] == "invalid_args"
    assert drafts.last_kwargs is None
