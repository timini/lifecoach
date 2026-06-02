"""`create_draft_email` — save a Gmail draft without sending it.

The tool builds a small RFC 5322 message locally and calls
``gmail.users.drafts.create``. Keeping the MIME/base64url work here means the
LLM only supplies normal email fields and never has to reason about Gmail's raw
message wire format.
"""

from __future__ import annotations

import base64
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

CREATE_DRAFT_EMAIL_TOOL_NAME = "create_draft_email"


def _normalise_addresses(value: str | list[str]) -> list[str]:
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",")]
    else:
        parts = [str(p).strip() for p in value]
    return [p for p in parts if p]


def _set_address_header(msg: EmailMessage, name: str, value: str | list[str] | None) -> None:
    if value is None:
        return
    addresses = _normalise_addresses(value)
    if addresses:
        # Let EmailMessage validate/encode display names. Plain addresses
        # round-trip unchanged; values like "Ada <ada@example.com>" are also
        # accepted by the email package.
        msg[name] = ", ".join(
            formataddr(("", addr)) if "<" not in addr else addr for addr in addresses
        )


def _build_raw_message(
    *,
    to: str | list[str],
    subject: str,
    body: str,
    cc: str | list[str] | None = None,
    bcc: str | list[str] | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> str:
    msg = EmailMessage()
    _set_address_header(msg, "To", to)
    _set_address_header(msg, "Cc", cc)
    _set_address_header(msg, "Bcc", bcc)
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references
    msg.set_content(body)
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")


def create_create_draft_email_tool(deps: WorkspaceToolDeps) -> Any:
    async def create_draft_email(
        to: str | list[str],
        subject: str,
        body: str,
        cc: str | list[str] | None = None,
        bcc: str | list[str] | None = None,
        threadId: str | None = None,  # noqa: N803
        inReplyTo: str | None = None,  # noqa: N803
        references: str | None = None,
    ) -> dict[str, Any]:
        """Create a Gmail draft for the user to review; never sends.

        Use when the user asks you to draft/write/reply to an email in
        Gmail. If drafting a reply to an existing message, first look up
        the message, then pass its ``threadId`` plus the original
        ``Message-Id`` as ``inReplyTo`` and ``References`` when available.
        Ask for confirmation before creating the draft unless the user
        already explicitly approved the exact recipient, subject, and body
        in this turn.

        Args:
            to: Recipient email address(es). Accepts a comma-separated
                string or a list of addresses.
            subject: Email subject line.
            body: Plain-text email body.
            cc: Optional Cc recipient(s).
            bcc: Optional Bcc recipient(s).
            threadId: Optional Gmail thread id when drafting a reply.
            inReplyTo: Optional RFC 5322 Message-Id of the message being
                replied to; sets the In-Reply-To header.
            references: Optional References header for reply threading.
        """
        recipients = _normalise_addresses(to)
        if not recipients:
            return {
                "status": "error",
                "code": "invalid_args",
                "message": "At least one recipient is required to create a Gmail draft.",
            }
        if not subject.strip():
            return {
                "status": "error",
                "code": "invalid_args",
                "message": "A subject is required to create a Gmail draft.",
            }
        if not body.strip():
            return {
                "status": "error",
                "code": "invalid_args",
                "message": "A body is required to create a Gmail draft.",
            }

        raw = _build_raw_message(
            to=recipients,
            subject=subject,
            body=body,
            cc=cc,
            bcc=bcc,
            in_reply_to=inReplyTo,
            references=references,
        )
        message: dict[str, Any] = {"raw": raw}
        if threadId:
            message["threadId"] = threadId

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=CREATE_DRAFT_EMAIL_TOOL_NAME,
            service="gmail",
            resource="users.drafts",
            method="create",
            params={"userId": "me"},
            body={"message": message},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        raw_body = result.body if isinstance(result.body, dict) else {}
        raw_message = raw_body.get("message") if isinstance(raw_body.get("message"), dict) else {}
        return {
            "status": "ok",
            "draft": {
                "id": raw_body.get("id") or "",
                "messageId": raw_message.get("id") or "",
                "threadId": raw_message.get("threadId") or threadId or "",
            },
        }

    from google.adk.tools import FunctionTool

    create_draft_email.__name__ = CREATE_DRAFT_EMAIL_TOOL_NAME
    return FunctionTool(create_draft_email)


__all__ = [
    "CREATE_DRAFT_EMAIL_TOOL_NAME",
    "create_create_draft_email_tool",
    "_build_raw_message",
]
