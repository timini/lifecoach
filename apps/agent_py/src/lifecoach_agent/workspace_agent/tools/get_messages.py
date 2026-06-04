"""`get_messages` — bulk-fetch Gmail messages and return projections.

This is the batched companion to `get_message`: the sub-agent can fetch
several message bodies with one tool call instead of spending a separate
LLM/tool round-trip per message during inbox triage.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from lifecoach_agent.workspace_agent.projections import project_gmail_message
from lifecoach_agent.workspace_agent.run_gws import RunGwsErr, RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

GET_MESSAGES_TOOL_NAME = "get_messages"
_MAX_BULK_MESSAGES = 50


def create_get_messages_tool(deps: WorkspaceToolDeps) -> Any:
    async def get_messages(
        ids: list[str], format: Literal["full", "metadata"] = "full"
    ) -> dict[str, Any]:
        """Fetch several Gmail messages by id and return projected shapes.
        Read-only. Prefer this over repeated get_message calls when you
        need several email bodies for triage.

        Args:
            ids: Gmail message ids (from list_inbox or search_messages).
                At most 50 ids are fetched; empty/duplicate ids are ignored.
            format: "full" includes decoded body text; "metadata" omits
                it. Default "full".
        """
        unique_ids = _normalise_ids(ids)
        if not unique_ids:
            return {"status": "ok", "messages": [], "count": 0}

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
        errors: list[dict[str, Any]] = []
        truncated = False
        for mid, result in zip(unique_ids, results, strict=True):
            if isinstance(result, RunGwsOk):
                raw = result.body if isinstance(result.body, dict) else {}
                projection = project_gmail_message(raw)
                messages.append(projection.model_dump(by_alias=True, exclude_none=True))
                truncated = truncated or result.truncated
                continue

            err: RunGwsErr = result
            errors.append({"id": mid, "code": err.code, "message": err.message})

        if not messages and errors:
            first = errors[0]
            return {
                "status": "error",
                "code": first["code"],
                "message": first["message"],
                "errors": errors,
                "count": 0,
            }

        out: dict[str, Any] = {"status": "ok", "messages": messages, "count": len(messages)}
        if errors:
            out["errors"] = errors
        if truncated:
            out["truncated"] = True
        return out

    from google.adk.tools import FunctionTool  # type: ignore[attr-defined]

    get_messages.__name__ = GET_MESSAGES_TOOL_NAME
    return FunctionTool(get_messages)


def _normalise_ids(ids: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in ids:
        mid = raw.strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append(mid)
        if len(out) >= _MAX_BULK_MESSAGES:
            break
    return out
