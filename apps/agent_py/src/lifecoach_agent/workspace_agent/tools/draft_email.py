"""`draft_email` — create a Gmail draft the user can review/send.

The tool writes only to Gmail Drafts. It never sends mail. The LLM hands
us structured fields; this module builds the RFC 2822 message, base64url
encodes it, and calls ``gmail.users.drafts.create``.
"""

from __future__ import annotations

import base64
from email.message import EmailMessage
from email.policy import SMTP
from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

DRAFT_EMAIL_TOOL_NAME = "draft_email"


class _HeaderInjectionError(ValueError):
    """Raised when a header value contains a CR/LF. A model-supplied (and
    ultimately user-pasted) subject or recipient with an embedded newline
    could otherwise smuggle extra headers or a body into the MIME message."""


def _check_no_newlines(label: str, values: list[str]) -> None:
    for value in values:
        if "\n" in value or "\r" in value:
            raise _HeaderInjectionError(f"{label} must not contain line breaks.")


def _normalise_recipients(value: list[str] | str | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [item for item in value if item]


def _encode_rfc2822_message(
    *,
    to: list[str] | str,
    subject: str,
    body: str,
    cc: list[str] | str | None = None,
    bcc: list[str] | str | None = None,
    reply_to: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> str:
    """Build a Gmail API ``raw`` payload from structured email fields.

    Raises ``_HeaderInjectionError`` if any header value contains a line
    break, so a pasted multi-line subject / recipient can't inject headers.
    """
    message = EmailMessage(policy=SMTP)
    to_values = _normalise_recipients(to)
    cc_values = _normalise_recipients(cc)
    bcc_values = _normalise_recipients(bcc)

    _check_no_newlines("to", to_values)
    _check_no_newlines("cc", cc_values)
    _check_no_newlines("bcc", bcc_values)
    _check_no_newlines("subject", [subject])
    for label, value in (
        ("replyTo", reply_to),
        ("inReplyTo", in_reply_to),
        ("references", references),
    ):
        if value:
            _check_no_newlines(label, [value])

    if to_values:
        message["To"] = ", ".join(to_values)
    if cc_values:
        message["Cc"] = ", ".join(cc_values)
    if bcc_values:
        message["Bcc"] = ", ".join(bcc_values)
    if reply_to:
        message["Reply-To"] = reply_to
    if in_reply_to:
        message["In-Reply-To"] = in_reply_to
    if references:
        message["References"] = references
    message["Subject"] = subject
    message.set_content(body)

    return base64.urlsafe_b64encode(message.as_bytes(policy=SMTP)).decode("ascii")


def create_draft_email_tool(deps: WorkspaceToolDeps) -> Any:
    async def draft_email(
        to: list[str],
        subject: str,
        body: str,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        threadId: str | None = None,  # noqa: N803
        replyTo: str | None = None,  # noqa: N803
        inReplyTo: str | None = None,  # noqa: N803
        references: str | None = None,
    ) -> dict[str, Any]:
        """Create a Gmail draft for the user to review and send later.
        Never sends email.

        Args:
            to: Recipient email addresses.
            subject: Email subject line.
            body: Plain-text email body.
            cc: Optional CC recipient email addresses.
            bcc: Optional BCC recipient email addresses.
            threadId: Optional Gmail thread id to attach this draft to an
                existing conversation.
            replyTo: Optional Reply-To header value.
            inReplyTo: Optional RFC 2822 Message-ID when drafting a reply.
            references: Optional References header when drafting a reply.
        """
        # Gmail only threads a draft onto an existing conversation when the
        # raw message carries In-Reply-To / References headers (a bare
        # threadId is orphaned or rejected). Triage hands the model a
        # threadId but not the source Message-ID, so require the reply
        # headers rather than silently producing a non-threading draft.
        if threadId and not (inReplyTo or references):
            return {
                "status": "error",
                "code": "invalid_args",
                "message": (
                    "To thread a reply draft, pass inReplyTo (and references) from the "
                    "original message — get_message exposes them — not just threadId."
                ),
            }

        try:
            raw = _encode_rfc2822_message(
                to=to,
                subject=subject,
                body=body,
                cc=cc,
                bcc=bcc,
                reply_to=replyTo,
                in_reply_to=inReplyTo,
                references=references,
            )
        except _HeaderInjectionError as err:
            return {"status": "error", "code": "invalid_args", "message": str(err)}
        message_body: dict[str, Any] = {"raw": raw}
        if threadId:
            message_body["threadId"] = threadId

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=DRAFT_EMAIL_TOOL_NAME,
            service="gmail",
            resource="users.drafts",
            method="create",
            params={"userId": "me"},
            body={"message": message_body},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}

        raw_body = result.body if isinstance(result.body, dict) else {}
        message_value = raw_body.get("message")
        message: dict[str, Any] = message_value if isinstance(message_value, dict) else {}
        out: dict[str, Any] = {
            "status": "ok",
            "draftId": raw_body.get("id"),
            "messageId": message.get("id"),
        }
        returned_thread_id = message.get("threadId") or threadId
        if returned_thread_id:
            out["threadId"] = returned_thread_id
        if result.truncated:
            out["truncated"] = True
        return out

    from google.adk.tools import FunctionTool  # type: ignore[attr-defined]

    draft_email.__name__ = DRAFT_EMAIL_TOOL_NAME
    return FunctionTool(draft_email)


__all__ = ["DRAFT_EMAIL_TOOL_NAME", "create_draft_email_tool", "_encode_rfc2822_message"]
