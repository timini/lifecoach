"""`complete_notion_task` — the ONLY path to mark a task Done.

Separate from update_notion_task so the prompt's "never mark Done
without explicit user confirmation" rule has a dedicated tool to
gate on. The tool itself doesn't enforce the confirmation; that's
the LLM's job per the cheatsheet. Splitting it out makes the
trajectory eval pin "this tool was called only after a user-
confirmation question fired" easy.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.notion_agent.projections import project_notion_task
from lifecoach_agent.notion_agent.run_notion import RunNotionErr, RunNotionOk, run_notion
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps
from lifecoach_agent.notion_agent.tools._properties import (
    PROP_NOTES,
    PROP_STATUS,
    rich_text_property,
    select_property,
)
from lifecoach_agent.notion_agent.tools.update_notion_task import (
    _existing_notes_text,  # noqa: PLC2701 — intentional reuse
)

COMPLETE_NOTION_TASK_TOOL_NAME = "complete_notion_task"


def create_complete_notion_task_tool(deps: NotionToolDeps) -> Any:
    async def complete_notion_task(
        id: str,  # noqa: A002 — LLM-facing param name
        completion_note: str | None = None,
    ) -> dict[str, Any]:
        """Mark a task Done. The user MUST have confirmed this turn,
        or you MUST ask first via ask_single_choice_question. If
        `completion_note` is provided, appends one final line to Notes
        ("Completed: <note>") for audit recall."""
        if not id or not isinstance(id, str):
            return {"status": "error", "code": "bad_request", "message": "id required"}

        properties: dict[str, Any] = {PROP_STATUS: select_property("Done")}

        if completion_note:
            existing_result = await run_notion(
                store=deps.store,
                uid=deps.uid,
                tool_name=COMPLETE_NOTION_TASK_TOOL_NAME,
                method="GET",
                path=f"/v1/pages/{id}",
                http=deps.http,
                log=deps.log,
            )
            if isinstance(existing_result, RunNotionErr):
                return {
                    "status": "error",
                    "code": existing_result.code,
                    "message": existing_result.message,
                }
            assert isinstance(existing_result, RunNotionOk)
            existing_notes = _existing_notes_text(
                existing_result.body if isinstance(existing_result.body, dict) else {}
            )
            new_line = f"Completed: {completion_note}"
            text = f"{existing_notes}\n{new_line}".lstrip() if existing_notes else new_line
            properties[PROP_NOTES] = rich_text_property(text)

        result = await run_notion(
            store=deps.store,
            uid=deps.uid,
            tool_name=COMPLETE_NOTION_TASK_TOOL_NAME,
            method="PATCH",
            path=f"/v1/pages/{id}",
            body={"properties": properties},
            http=deps.http,
            log=deps.log,
        )
        if isinstance(result, RunNotionErr):
            return {"status": "error", "code": result.code, "message": result.message}
        assert isinstance(result, RunNotionOk)
        page = result.body if isinstance(result.body, dict) else {}
        return {"status": "ok", "task": project_notion_task(page).model_dump()}

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    complete_notion_task.__name__ = COMPLETE_NOTION_TASK_TOOL_NAME
    return FunctionTool(complete_notion_task)
