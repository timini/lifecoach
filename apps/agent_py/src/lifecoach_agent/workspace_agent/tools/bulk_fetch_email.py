"""`bulk_fetch_email` — fetch multiple Gmail messages in one tool call.

The triage sub-agent often needs full bodies for every id returned by
`list_inbox`. Calling `get_message` once per email forces the model to
spend a turn per id; this tool fans those reads out concurrently and
returns the same projected shape as `get_message` in a single response.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from lifecoach_agent.workspace_agent.projections import project_gmail_message
from lifecoach_agent.workspace_agent.run_gws import RunGwsErr, RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

BULK_FETCH_EMAIL_TOOL_NAME = "bulk_fetch_email"


def create_bulk_fetch_email_tool(deps: WorkspaceToolDeps) -> Any:
    async def bulk_fetch_email(
        ids: list[str], format: Literal["full", "metadata"] = "full"
    ) -> dict[str, Any]:
        """Fetch multiple Gmail messages by id. Read-only.

        Args:
            ids: Gmail message ids (from list_inbox or search_messages).
                Up to 50 ids are fetched, concurrently, preserving input order.
            format: "full" includes decoded bodies; "metadata" omits them.
                Default "full".
        """
        message_ids = [mid for mid in ids[:50] if isinstance(mid, str) and mid]
        if not message_ids:
            return {"status": "ok", "messages": [], "failed": []}

        results = await asyncio.gather(
            *[
                run_gws(
                    store=deps.store,
                    uid=deps.uid,
                    tool_name=BULK_FETCH_EMAIL_TOOL_NAME,
                    service="gmail",
                    resource="users.messages",
                    method="get",
                    params={"userId": "me", "id": mid, "format": format},
                    build_client=deps.build_client,
                    log=deps.log,
                )
                for mid in message_ids
            ]
        )

        messages: list[dict[str, Any]] = []
        failed: list[dict[str, str]] = []
        for mid, result in zip(message_ids, results, strict=True):
            if isinstance(result, RunGwsOk):
                raw = result.body if isinstance(result.body, dict) else {}
                projection = project_gmail_message(raw)
                messages.append(projection.model_dump(by_alias=True, exclude_none=True))
                continue

            err: RunGwsErr = result
            failed.append({"id": mid, "code": err.code, "message": err.message})

        scope_error = next((item for item in failed if item["code"] == "scope_required"), None)
        if scope_error is not None:
            return {"status": "error", "code": "scope_required", "message": scope_error["message"]}

        return {"status": "ok", "messages": messages, "failed": failed}

    from google.adk.tools.function_tool import FunctionTool

    bulk_fetch_email.__name__ = BULK_FETCH_EMAIL_TOOL_NAME
    return FunctionTool(bulk_fetch_email)
