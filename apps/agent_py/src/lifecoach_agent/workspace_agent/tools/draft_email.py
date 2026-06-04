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


def _gmail_draft_url(message_id: str | None) -> str:
    """Deep-link that opens the draft in the Gmail web UI for review/send.
    Falls back to the Drafts folder when we don't have a message id."""
    if message_id:
        return f"https://mail.google.com/mail/u/0/#drafts?compose={message_id}"
    return "https://mail.google.com/mail/u/0/#drafts"


async def _thread_reply_message_id(deps: WorkspaceToolDeps, thread_id: str) -> str | None:
    """Best-effort: fetch a thread's most recent message and return its
    RFC2822 ``Message-Id`` so a reply draft can carry In-Reply-To /
    References (proper threading) even when the caller only has a threadId
    (e.g. from triage). Returns None on any failure — the draft still
    attaches to the thread via ``threadId`` regardless."""
    result = await run_gws(
        store=deps.store,
        uid=deps.uid,
        tool_name=DRAFT_EMAIL_TOOL_NAME,
        service="gmail",
        resource="users.threads",
        method="get",
        params={
            "userId": "me",
            "id": thread_id,
            "format": "metadata",
            "metadataHeaders": ["Message-Id", "References"],
        },
        build_client=deps.build_client,
        log=deps.log,
    )
    if not isinstance(result, RunGwsOk):
        return None
    body = result.body if isinstance(result.body, dict) else {}
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return None
    last = messages[-1] if isinstance(messages[-1], dict) else {}
    payload_val = last.get("payload")
    payload: dict[str, Any] = payload_val if isinstance(payload_val, dict) else {}
    for header in payload.get("headers") or []:
        if isinstance(header, dict) and str(header.get("name", "")).lower() == "message-id":
            value = header.get("value")
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


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
        Never sends email. Returns a `url` deep-link to the draft in Gmail —
        ALWAYS share it with the user in your reply.

        Args:
            to: Recipient email addresses.
            subject: Email subject line.
            body: Plain-text email body.
            cc: Optional CC recipient email addresses.
            bcc: Optional BCC recipient email addresses.
            threadId: Gmail thread id to reply within an existing
                conversation. Pass this for replies — the tool attaches the
                draft to the thread and derives the reply headers itself, so
                you do NOT need inReplyTo/references.
            replyTo: Optional Reply-To header value.
            inReplyTo: Optional RFC 2822 Message-ID — only if you already
                have it; otherwise the tool fetches it from threadId.
            references: Optional References header for the reply chain.
        """
        # Proper threading wants In-Reply-To / References headers, but the
        # caller usually only has a threadId (e.g. from triage). Rather than
        # reject — which pushes the model to drop threadId and start a NEW
        # conversation — derive the source Message-ID from the thread itself.
        # If that lookup fails we still proceed: a draft created with
        # `threadId` is attached to the thread in Gmail regardless.
        if threadId and not inReplyTo:
            inReplyTo = await _thread_reply_message_id(deps, threadId)
        if inReplyTo and not references:
            references = inReplyTo

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
        message_id = message.get("id")
        out: dict[str, Any] = {
            "status": "ok",
            "draftId": raw_body.get("id"),
            "messageId": message_id,
            # Deep-link the agent MUST surface so the user can open/send the
            # draft directly in Gmail.
            "url": _gmail_draft_url(message_id if isinstance(message_id, str) else None),
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
