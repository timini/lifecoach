"""`draft_email` — create a Gmail draft without sending it."""

from __future__ import annotations

import base64
from email.message import EmailMessage
from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

DRAFT_EMAIL_TOOL_NAME = "draft_email"


def _encode_raw_message(message: EmailMessage) -> str:
    """Encode a message for Gmail's `raw` field.

    Gmail expects RFC 2822 bytes using URL-safe base64 without relying on
    OAuth/client-side mail helpers. Keeping this local makes the tool easy
    to unit test and prevents the LLM from ever handling the encoded value.
    """
    return base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")


def build_draft_email_body(
    *,
    to: str,
    subject: str,
    body: str,
    cc: str | None = None,
    bcc: str | None = None,
    thread_id: str | None = None,
) -> dict[str, Any]:
    """Build the Gmail drafts.create request body for a plain-text draft."""
    message = EmailMessage()
    message["To"] = to
    if cc:
        message["Cc"] = cc
    if bcc:
        message["Bcc"] = bcc
    message["Subject"] = subject
    message.set_content(body)

    draft_message: dict[str, Any] = {"raw": _encode_raw_message(message)}
    if thread_id:
        draft_message["threadId"] = thread_id
    return {"message": draft_message}


def create_draft_email_tool(deps: WorkspaceToolDeps) -> Any:
    async def draft_email(
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
        threadId: str | None = None,  # noqa: N803
    ) -> dict[str, Any]:
        """Create a Gmail draft. Never sends email.

        Args:
            to: Recipient email address(es), comma-separated if needed.
            subject: Draft subject line.
            body: Plain-text draft body.
            cc: Optional Cc recipient email address(es), comma-separated.
            bcc: Optional Bcc recipient email address(es), comma-separated.
            threadId: Optional Gmail thread id to draft a reply in an existing thread.
        """
        request_body = build_draft_email_body(
            to=to,
            subject=subject,
            body=body,
            cc=cc,
            bcc=bcc,
            thread_id=threadId,
        )
        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=DRAFT_EMAIL_TOOL_NAME,
            service="gmail",
            resource="users.drafts",
            method="create",
            params={"userId": "me"},
            body=request_body,
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        raw = result.body if isinstance(result.body, dict) else {}
        message = raw.get("message") if isinstance(raw.get("message"), dict) else {}
        draft: dict[str, Any] = {
            "id": raw.get("id"),
            "messageId": message.get("id"),
            "threadId": message.get("threadId") or threadId,
        }
        return {"status": "ok", "draft": {k: v for k, v in draft.items() if v is not None}}

    from google.adk.tools import FunctionTool

    draft_email.__name__ = DRAFT_EMAIL_TOOL_NAME
    return FunctionTool(draft_email)
