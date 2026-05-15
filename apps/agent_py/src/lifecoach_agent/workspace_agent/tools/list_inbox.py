"""`list_inbox` — sub-agent read tool. Returns id+threadId+snippet
summaries (no body). The sub-agent calls `get_message` per id when it
wants full content.
"""

from __future__ import annotations

import asyncio
from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

LIST_INBOX_TOOL_NAME = "list_inbox"


def create_list_inbox_tool(deps: WorkspaceToolDeps) -> Any:
    async def list_inbox(
        unread_only: bool = False, since: str = "1d", limit: int = 15
    ) -> dict[str, Any]:
        """List recent inbox messages as id+threadId+snippet summaries
        (no body). Use get_message per id to read full content. Read-only.

        Args:
            unread_only: When true, restrict to unread messages only.
            since: Gmail-style relative window (e.g. "1d", "12h", "3d").
                Default "1d" — last 24 hours.
            limit: Maximum number of messages to return (1–50). Default 15.
        """
        query_parts = ["in:inbox"]
        if unread_only:
            query_parts.append("is:unread")
        query_parts.append(f"newer_than:{since}")
        q = " ".join(query_parts)
        max_results = max(1, min(int(limit), 50))

        list_result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=LIST_INBOX_TOOL_NAME,
            service="gmail",
            resource="users.messages",
            method="list",
            params={"userId": "me", "q": q, "maxResults": max_results},
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
        unique_ids: list[str] = []
        seen_ids: set[str] = set()
        for mid in ids:
            if not mid or mid in seen_ids:
                continue
            seen_ids.add(mid)
            unique_ids.append(mid)
        ids = unique_ids
        if not ids:
            return {"status": "ok", "messages": []}

        details = await asyncio.gather(
            *[
                run_gws(
                    store=deps.store,
                    uid=deps.uid,
                    tool_name=LIST_INBOX_TOOL_NAME,
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
        returned_ids: set[str] = set()
        for detail in details:
            if not isinstance(detail, RunGwsOk):
                continue
            m = detail.body if isinstance(detail.body, dict) else {}
            mid = m.get("id")
            if not isinstance(mid, str) or mid in returned_ids:
                continue
            returned_ids.add(mid)
            messages.append(
                {
                    "id": mid,
                    "threadId": m.get("threadId") or mid,
                    "snippet": m.get("snippet") or "",
                }
            )
        out: dict[str, Any] = {"status": "ok", "messages": messages}
        if list_result.truncated:
            out["truncated"] = True
        return out

    from google.adk.tools import FunctionTool

    list_inbox.__name__ = LIST_INBOX_TOOL_NAME
    return FunctionTool(list_inbox)
