"""`get_message` — fetch a Gmail message and return the projection.
Decoded body, allow-listed headers, 4 KB cap. Base64 decode never
escapes to the LLM side.
"""

from __future__ import annotations

from typing import Any, Literal

from lifecoach_agent.workspace_agent.projections import project_gmail_message
from lifecoach_agent.workspace_agent.run_gws import RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

GET_MESSAGE_TOOL_NAME = "get_message"


def create_get_message_tool(deps: WorkspaceToolDeps) -> Any:
    message_cache: dict[tuple[str, str], dict[str, Any]] = {}

    async def get_message(id: str, format: Literal["full", "metadata"] = "full") -> dict[str, Any]:
        """Fetch a single Gmail message by id and return the projected
        shape (decoded body, allow-listed headers). Read-only.

        Args:
            id: Gmail message id (from list_inbox or search_messages).
            format: "full" includes the body (decoded text); "metadata"
                omits it. Default "full".
        """
        cache_key = (id, format)
        cached = message_cache.get(cache_key)
        if cached is not None:
            return cached

        result = await run_gws(
            store=deps.store,
            uid=deps.uid,
            tool_name=GET_MESSAGE_TOOL_NAME,
            service="gmail",
            resource="users.messages",
            method="get",
            params={"userId": "me", "id": id, "format": format},
            build_client=deps.build_client,
            log=deps.log,
        )
        if not isinstance(result, RunGwsOk):
            return {"status": "error", "code": result.code, "message": result.message}
        raw = result.body if isinstance(result.body, dict) else {}
        projection = project_gmail_message(raw)
        response = {
            "status": "ok",
            "message": projection.model_dump(by_alias=True, exclude_none=True),
        }
        message_cache[cache_key] = response
        return response

    from google.adk.tools import FunctionTool

    get_message.__name__ = GET_MESSAGE_TOOL_NAME
    return FunctionTool(get_message)
