from __future__ import annotations

import base64
from email import policy
from email.parser import BytesParser
from typing import Any

import pytest

from lifecoach_agent.workspace_agent.run_gws import RunGwsLogEvent
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps
from lifecoach_agent.workspace_agent.tools.draft_email import (
    DRAFT_EMAIL_TOOL_NAME,
    build_draft_email_body,
    create_draft_email_tool,
)


def _decode_raw(raw: str) -> Any:
    return BytesParser(policy=policy.default).parsebytes(
        base64.urlsafe_b64decode(raw.encode("ascii"))
    )


def test_build_draft_email_body_encodes_plain_text_message() -> None:
    body = build_draft_email_body(
        to="alex@example.com",
        cc="sam@example.com",
        bcc="ops@example.com",
        subject="Running late",
        body="I'm running 10 minutes late — see you soon.",
        thread_id="thread-1",
    )

    message = body["message"]
    assert message["threadId"] == "thread-1"
    decoded = _decode_raw(message["raw"])
    assert decoded["To"] == "alex@example.com"
    assert decoded["Cc"] == "sam@example.com"
    assert decoded["Bcc"] == "ops@example.com"
    assert decoded["Subject"] == "Running late"
    assert decoded.get_content().strip() == "I'm running 10 minutes late — see you soon."


@pytest.mark.asyncio
async def test_draft_email_creates_gmail_draft_without_sending() -> None:
    calls: list[dict[str, Any]] = []
    log_events: list[RunGwsLogEvent] = []

    class Store:
        async def get_valid_access_token(self, uid: str) -> str:
            assert uid == "u1"
            return "token"

    class Request:
        def __init__(self, kwargs: dict[str, Any]) -> None:
            self.kwargs = kwargs

        def execute(self) -> dict[str, Any]:
            calls.append(self.kwargs)
            return {
                "id": "draft-1",
                "message": {"id": "msg-1", "threadId": "thread-1"},
            }

    class Drafts:
        def create(self, **kwargs: Any) -> Request:
            return Request(kwargs)

        def send(self, **kwargs: Any) -> Request:
            raise AssertionError("draft_email must not send email")

    class Users:
        def drafts(self) -> Drafts:
            return Drafts()

    class Client:
        def users(self) -> Users:
            return Users()

    def build_client(service: str, access_token: str) -> Client:
        assert service == "gmail"
        assert access_token == "token"
        return Client()

    tool = create_draft_email_tool(
        WorkspaceToolDeps(
            store=Store(),
            uid="u1",
            build_client=build_client,
            log=log_events.append,
        )
    )

    result = await tool.func(
        to="alex@example.com",
        subject="Running late",
        body="I'm running 10 minutes late.",
        threadId="thread-1",
    )

    assert result == {
        "status": "ok",
        "draft": {"id": "draft-1", "messageId": "msg-1", "threadId": "thread-1"},
    }
    assert len(calls) == 1
    assert calls[0]["userId"] == "me"
    assert "send" not in calls[0]
    request_body = calls[0]["body"]
    assert request_body["message"]["threadId"] == "thread-1"
    assert _decode_raw(request_body["message"]["raw"])["To"] == "alex@example.com"
    assert log_events[-1].name == DRAFT_EMAIL_TOOL_NAME
    assert log_events[-1].resource == "users.drafts"
    assert log_events[-1].method == "create"
