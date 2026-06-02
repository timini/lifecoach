"""`get_messages` — bulk-fetch Gmail messages and return projections.

This is the fast path for inbox triage: the sub-agent can list ids once,
then fetch all selected messages with one tool call instead of issuing a
separate `get_message` call for every email.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from lifecoach_agent.workspace_agent.projections import project_gmail_message
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

GET_MESSAGES_TOOL_NAME = "get_messages"
_MAX_BULK_MESSAGES = 50


def create_get_messages_tool(deps: WorkspaceToolDeps) -> Any:
    async def get_messages(
        ids: list[str], format: Literal["full", "metadata"] = "full"
    ) -> dict[str, Any]:
        """Fetch multiple Gmail messages by id and return projected shapes.
        Use this after list_inbox/search_messages when reading more than one
        message. Read-only.

        Args:
            ids: Gmail message ids (from list_inbox or search_messages).
                Duplicates/blank ids are ignored. Maximum 50.
            format: "full" includes decoded bodies; "metadata" omits
                bodies. Default "full".
        """
        unique_ids = _normalise_ids(ids)
        if not unique_ids:
            return {"status": "ok", "messages": [], "failed": []}

        results = await asyncio.gather(
            *[
                run_gws(
                    store=deps.store,
                    uid=deps.uid,
                    tool_name=GET_MESSAGES_TOOL_NAME,
                    service="gmail",
                    resource="users.messages",
                    method="get",
                    params={"userId": "me", "id": mid, "format": format},
                    build_client=deps.build_client,
                    log=deps.log,
                )
                for mid in unique_ids
            ]
        )

        messages: list[dict[str, Any]] = []
        failed: list[dict[str, str]] = []
        for mid, result in zip(unique_ids, results, strict=True):
            if isinstance(result, RunGwsOk):
                raw = result.body if isinstance(result.body, dict) else {}
                projection = project_gmail_message(raw)
                messages.append(projection.model_dump(by_alias=True, exclude_none=True))
                continue
            failed.append({"id": mid, "code": result.code, "message": result.message})

        scope_required = next((f for f in failed if f["code"] == "scope_required"), None)
        if scope_required is not None:
            return {
                "status": "error",
                "code": "scope_required",
                "message": scope_required["message"],
                "messages": messages,
                "failed": failed,
            }

        return {"status": "ok", "messages": messages, "failed": failed}

    from google.adk.tools.function_tool import FunctionTool

    get_messages.__name__ = GET_MESSAGES_TOOL_NAME
    return FunctionTool(get_messages)


def _normalise_ids(ids: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for raw_id in ids:
        mid = raw_id.strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        unique.append(mid)
        if len(unique) >= _MAX_BULK_MESSAGES:
            break
    return unique
