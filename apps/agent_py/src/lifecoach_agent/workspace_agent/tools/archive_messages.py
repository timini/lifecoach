"""`archive_messages` — remove the INBOX label from one or more Gmail
messages. Idempotent. Loops server-side so the LLM sees one tool call.
"""

from __future__ import annotations

import asyncio
from typing import Any

from lifecoach_agent.workspace_agent.run_gws import RunGwsErr, RunGwsOk, run_gws
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

ARCHIVE_MESSAGES_TOOL_NAME = "archive_messages"


def create_archive_messages_tool(deps: WorkspaceToolDeps) -> Any:
    async def archive_messages(ids: list[str]) -> dict[str, Any]:
        """Archive Gmail messages by removing the INBOX label. Idempotent.
        Returns archived[] and failed[] arrays. Use after the user
        confirms via ask_single_choice_question.

        Args:
            ids: Gmail message ids to archive. Use the ids from a
                triage_inbox report or from find_workspace. Pass them
                all at once — the tool batches them server-side.
        """
        if not ids:
            return {"status": "ok", "archived": [], "failed": []}

        results = await asyncio.gather(
            *[
                run_gws(
                    store=deps.store,
                    uid=deps.uid,
                    tool_name=ARCHIVE_MESSAGES_TOOL_NAME,
                    service="gmail",
                    resource="users.messages",
                    method="modify",
                    params={"userId": "me", "id": mid},
                    body={"removeLabelIds": ["INBOX"]},
                    build_client=deps.build_client,
                    log=deps.log,
                )
                for mid in ids
            ]
        )

        archived: list[str] = []
        failed: list[dict[str, str]] = []
        for mid, result in zip(ids, results, strict=True):
            if isinstance(result, RunGwsOk):
                archived.append(mid)
            else:
                err: RunGwsErr = result
                failed.append({"id": mid, "code": err.code, "message": err.message})

        # Any scope_required failure means run_gws has already deleted
        # the user's token doc — the connection is gone for the rest of
        # this turn and every future call. Surface a top-level
        # scope_required error so the LLM reconnects via
        # connect_workspace; otherwise the WORKSPACE_CHEATSHEET error-
        # handling rules wouldn't trigger reconnect and the user is
        # left in a broken state. Scan ALL failures (not just failed[0])
        # because partial-success batches can hide the scope_required
        # entry anywhere in the list.
        scope_failure = next(
            (f for f in failed if f["code"] == "scope_required"), None
        )
        if scope_failure is not None:
            return {
                "status": "error",
                "code": "scope_required",
                "message": scope_failure["message"],
            }
        return {"status": "ok", "archived": archived, "failed": failed}

    from google.adk.tools import FunctionTool

    archive_messages.__name__ = ARCHIVE_MESSAGES_TOOL_NAME
    return FunctionTool(archive_messages)
