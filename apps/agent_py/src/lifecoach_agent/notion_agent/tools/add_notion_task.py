"""`add_notion_task` — create a new task in the Lifecoach Tasks DB."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.notion_agent.database_bootstrap import (
    DatabaseUnavailableError,
    get_or_create_database,
)
from lifecoach_agent.notion_agent.projections import project_notion_task
from lifecoach_agent.notion_agent.run_notion import RunNotionErr, RunNotionOk, run_notion
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps
from lifecoach_agent.notion_agent.tools._properties import (
    PROP_DUE,
    PROP_NOTES,
    PROP_PARENT,
    PROP_PRIORITY,
    PROP_PROJECT,
    PROP_STATUS,
    PROP_TITLE,
    date_property,
    relation_property,
    rich_text_property,
    select_property,
    title_property,
)

ADD_NOTION_TASK_TOOL_NAME = "add_notion_task"

_DEFAULT_STATUS = "To Do"


def create_add_notion_task_tool(deps: NotionToolDeps) -> Any:
    async def add_notion_task(
        title: str,
        project: str | None = None,
        priority: str | None = None,
        due: str | None = None,
        parent_id: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        """Create a new Notion task.

        Args:
            title: Required. Clear, action-oriented (Notion's prompt
                rules: "include enough context to act on").
            project: Project select value. New values create on use.
            priority: One of "Urgent", "High", "Medium", "Low".
            due: YYYY-MM-DD or RFC3339 string.
            parent_id: Notion page id of the parent task — makes this
                a sub-task in the tree.
            notes: Initial state-of-play (the rich_text field that
                update_notion_task appends to as work progresses).
        """
        if not title or not isinstance(title, str):
            return {"status": "error", "code": "bad_request", "message": "title required"}

        try:
            db_id = await get_or_create_database(deps)
        except DatabaseUnavailableError as err:
            return {"status": "error", "code": err.code, "message": str(err)}

        properties: dict[str, Any] = {
            PROP_TITLE: title_property(title),
            PROP_STATUS: select_property(_DEFAULT_STATUS),
        }
        if project:
            properties[PROP_PROJECT] = select_property(project)
        if priority:
            properties[PROP_PRIORITY] = select_property(priority)
        if due:
            properties[PROP_DUE] = date_property(due)
        if parent_id:
            properties[PROP_PARENT] = relation_property([parent_id])
        if notes:
            properties[PROP_NOTES] = rich_text_property(notes)

        body = {
            "parent": {"database_id": db_id},
            "properties": properties,
        }

        result = await run_notion(
            store=deps.store,
            uid=deps.uid,
            tool_name=ADD_NOTION_TASK_TOOL_NAME,
            method="POST",
            path="/v1/pages",
            body=body,
            http=deps.http,
            log=deps.log,
        )

        if isinstance(result, RunNotionErr):
            return {"status": "error", "code": result.code, "message": result.message}

        assert isinstance(result, RunNotionOk)
        page = result.body if isinstance(result.body, dict) else {}
        return {"status": "ok", "task": project_notion_task(page).model_dump()}

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    add_notion_task.__name__ = ADD_NOTION_TASK_TOOL_NAME
    return FunctionTool(add_notion_task)
