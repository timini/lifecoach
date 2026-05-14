"""`update_notion_task` — patch a task's status/notes/priority/etc.

Notes default to APPEND mode (Notion is the knowledge base — never
overwrite state-of-play silently). Status accepts To Do / In Progress
/ Waiting only — `complete_notion_task` is the dedicated path for
marking Done so the confirmation rule can be enforced there.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.notion_agent.projections import project_notion_task
from lifecoach_agent.notion_agent.run_notion import RunNotionErr, RunNotionOk, run_notion
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps
from lifecoach_agent.notion_agent.tools._properties import (
    PROP_DUE,
    PROP_NOTES,
    PROP_PRIORITY,
    PROP_PROJECT,
    PROP_STATUS,
    PROP_TITLE,
    date_property,
    rich_text_property,
    select_property,
    title_property,
)

UPDATE_NOTION_TASK_TOOL_NAME = "update_notion_task"

_STATUS_WHITELIST = {"To Do", "In Progress", "Waiting"}


def _existing_notes_text(page: dict[str, Any]) -> str:
    """Pull the existing Notes rich-text out of a page-retrieve
    response (so append mode can prepend the old text)."""
    props = page.get("properties") or {}
    if not isinstance(props, dict):
        return ""
    notes_prop = props.get(PROP_NOTES) or {}
    fragments = notes_prop.get("rich_text") if isinstance(notes_prop, dict) else []
    if not isinstance(fragments, list):
        return ""
    return "".join(f.get("plain_text", "") for f in fragments if isinstance(f, dict))


def create_update_notion_task_tool(deps: NotionToolDeps) -> Any:
    async def update_notion_task(
        id: str,  # noqa: A002 — LLM-facing param name
        status: str | None = None,
        notes: str | None = None,
        notes_mode: str = "append",
        priority: str | None = None,
        due: str | None = None,
        title: str | None = None,
        project: str | None = None,
    ) -> dict[str, Any]:
        """Patch a task. Status accepts To Do / In Progress / Waiting
        only — use complete_notion_task to mark Done. notes_mode
        defaults to "append"; pass "replace" only when the user
        explicitly asks to overwrite."""
        if not id or not isinstance(id, str):
            return {"status": "error", "code": "bad_request", "message": "id required"}

        if status is not None and status not in _STATUS_WHITELIST:
            return {
                "status": "error",
                "code": "bad_request",
                "message": (
                    f"status must be one of {sorted(_STATUS_WHITELIST)}; use "
                    "complete_notion_task to mark Done"
                ),
            }

        properties: dict[str, Any] = {}
        if status is not None:
            properties[PROP_STATUS] = select_property(status)
        if priority is not None:
            properties[PROP_PRIORITY] = select_property(priority or None)
        if due is not None:
            properties[PROP_DUE] = date_property(due or None)
        if title is not None and title:
            properties[PROP_TITLE] = title_property(title)
        if project is not None:
            properties[PROP_PROJECT] = select_property(project or None)

        if notes is not None:
            text: str
            if notes_mode == "replace":
                text = notes
            else:
                # Append mode: fetch existing notes, prepend, then patch.
                existing_result = await run_notion(
                    store=deps.store,
                    uid=deps.uid,
                    tool_name=UPDATE_NOTION_TASK_TOOL_NAME,
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
                existing_page = (
                    existing_result.body if isinstance(existing_result.body, dict) else {}
                )
                existing_notes = _existing_notes_text(existing_page)
                text = f"{existing_notes}\n{notes}".lstrip() if existing_notes else notes
            properties[PROP_NOTES] = rich_text_property(text)

        if not properties:
            return {
                "status": "error",
                "code": "bad_request",
                "message": "nothing to update — supply at least one of status/notes/priority/due/title/project",
            }

        result = await run_notion(
            store=deps.store,
            uid=deps.uid,
            tool_name=UPDATE_NOTION_TASK_TOOL_NAME,
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

    update_notion_task.__name__ = UPDATE_NOTION_TASK_TOOL_NAME
    return FunctionTool(update_notion_task)
