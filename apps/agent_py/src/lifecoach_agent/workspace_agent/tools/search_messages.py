"""`search_messages` — Gmail search across the whole mailbox, not just
the inbox. Returns id+threadId+snippet summaries; the sub-agent calls
get_messages for bulk full-body reads on matches it cares about.
"""

from __future__ import annotations

import asyncio
from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

SEARCH_MESSAGES_TOOL_NAME = "search_messages"


def create_search_messages_tool(deps: WorkspaceToolDeps) -> Any:
    async def search_messages(query: str, limit: int = 10) -> dict[str, Any]:
        """Search Gmail across all labels/folders using Gmail query syntax.
        Returns id+threadId+snippet summaries — call get_message for full
        body; use get_messages for bulk reads. Read-only.

        Args:
            query: Gmail search syntax — e.g. "from:sarah newer_than:7d",
                "subject:invoice", "label:starred".
            limit: Maximum number of messages to return (1–50). Default 10.
        """
        max_results = max(1, min(int(limit), 50))
        list_result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            # Reuse list_inbox name so all message-list logs cluster.
            tool_name="list_inbox",
            service="gmail",
            resource="users.messages",
            method="list",
            params={"userId": "me", "q": query, "maxResults": max_results},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(list_result, RunGwsOk):
            return {"status": "error", "code": list_result.code, "message": list_result.message}

        body = list_result.body if isinstance(list_result.body, dict) else {}
        ids = [
            m.get("id")
            for m in (body.get("messages") or [])
            if isinstance(m, dict) and isinstance(m.get("id"), str)
        ]
        ids = [i for i in ids if i]
        if not ids:
            return {"status": "ok", "messages": []}

        details = await asyncio.gather(
            *[
                run_gws(
                    store=deps.store,
                    uid=deps.uid,
                    tool_name=SEARCH_MESSAGES_TOOL_NAME,
                    service="gmail",
                    resource="users.messages",
                    method="get",
                    params={"userId": "me", "id": mid, "format": "metadata"},
                    build_client=deps.build_client,
                    log=deps.log,
                )
                for mid in ids
            ]
        )
        messages: list[dict[str, Any]] = []
        for detail in details:
            if not isinstance(detail, RunGwsOk):
                continue
            m = detail.body if isinstance(detail.body, dict) else {}
            mid = m.get("id")
            if not isinstance(mid, str):
                continue
            messages.append(
                {
                    "id": mid,
                    "threadId": m.get("threadId") or mid,
                    "snippet": m.get("snippet") or "",
                }
            )
        return {"status": "ok", "messages": messages}

    from google.adk.tools.function_tool import FunctionTool

    search_messages.__name__ = SEARCH_MESSAGES_TOOL_NAME
    return FunctionTool(search_messages)
