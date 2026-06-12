"""Project a raw Notion page into the flat NotionTaskProjection shape.

Notion's page response carries `properties` as a dict of property
objects each tagged by type — `title`, `select`, `date`, `rich_text`,
`relation`. The projection extracts the scalar value from each,
falling back to safe defaults (None / empty string) when the user has
renamed or removed a property.

Property keys defaulted to the names the bootstrap creates them with
in `database_bootstrap.py` ("Task", "Status", "Priority", "Project",
"Due Date", "Notes", "Parent item"). If a user renames a property in
Notion the projection returns the fallback default and a downstream
tool surfaces a `bad_request` once a write fails.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import (
    NotionPriority,
    NotionStatus,
    NotionTaskProjection,
)

# Notion-side property names. Singletons so a future schema-rename
# follow-up can override them here.
_PROP_TITLE = "Task"
_PROP_STATUS = "Status"
_PROP_PRIORITY = "Priority"
_PROP_PROJECT = "Project"
_PROP_DUE = "Due Date"
_PROP_NOTES = "Notes"
_PROP_PARENT = "Parent item"

_VALID_STATUSES: tuple[NotionStatus, ...] = ("To Do", "In Progress", "Waiting", "Done")
_VALID_PRIORITIES: tuple[NotionPriority, ...] = ("Urgent", "High", "Medium", "Low")


def _title_text(prop: dict[str, Any] | None) -> str:
    """Extract a title-type property's concatenated text. Title is a
    list of rich-text fragments; we join their `plain_text` fields."""
    if not isinstance(prop, dict):
        return ""
    fragments = prop.get("title") or []
    if not isinstance(fragments, list):
        return ""
    return "".join(f.get("plain_text", "") for f in fragments if isinstance(f, dict)).strip()


def _rich_text(prop: dict[str, Any] | None) -> str | None:
    if not isinstance(prop, dict):
        return None
    fragments = prop.get("rich_text") or []
    if not isinstance(fragments, list) or not fragments:
        return None
    text = "".join(f.get("plain_text", "") for f in fragments if isinstance(f, dict))
    return text or None


def _select_name(prop: dict[str, Any] | None) -> str | None:
    """Extract a select property's option name. Accepts both `select`
    (single-select) and `status` (Notion's built-in status type) — the
    external prompt-mining repo allows for both shapes."""
    if not isinstance(prop, dict):
        return None
    for key in ("select", "status"):
        opt = prop.get(key)
        if isinstance(opt, dict):
            name = opt.get("name")
            if isinstance(name, str) and name:
                return name
    return None


def _date_start(prop: dict[str, Any] | None) -> str | None:
    if not isinstance(prop, dict):
        return None
    date_obj = prop.get("date")
    if not isinstance(date_obj, dict):
        return None
    start = date_obj.get("start")
    return start if isinstance(start, str) and start else None


def _relation_first_id(prop: dict[str, Any] | None) -> str | None:
    if not isinstance(prop, dict):
        return None
    refs = prop.get("relation") or []
    if not isinstance(refs, list) or not refs:
        return None
    first = refs[0]
    if isinstance(first, dict):
        rid = first.get("id")
        if isinstance(rid, str) and rid:
            return rid
    return None


def _coerce_status(value: str | None) -> NotionStatus:
    if value in _VALID_STATUSES:
        return value  # type: ignore[return-value]
    # Unknown / missing status defaults to "To Do" — same as
    # add_notion_task's create-time default. Surfacing an exception
    # would block every projection over a single mis-typed row.
    return "To Do"


def _coerce_priority(value: str | None) -> NotionPriority | None:
    if value in _VALID_PRIORITIES:
        return value  # type: ignore[return-value]
    return None


def project_notion_task(page: dict[str, Any]) -> NotionTaskProjection:
    """Project a raw Notion page (as returned by `pages.retrieve` or
    `databases.query`) into the flat NotionTaskProjection shape."""
    props = page.get("properties") or {}
    if not isinstance(props, dict):
        props = {}

    title = _title_text(props.get(_PROP_TITLE))
    # Fallback: some users may have a generic "Name" title prop.
    if not title:
        title = _title_text(props.get("Name"))

    status = _coerce_status(_select_name(props.get(_PROP_STATUS)))
    priority = _coerce_priority(_select_name(props.get(_PROP_PRIORITY)))
    project = _select_name(props.get(_PROP_PROJECT))
    due = _date_start(props.get(_PROP_DUE))
    notes = _rich_text(props.get(_PROP_NOTES))
    parent_id = _relation_first_id(props.get(_PROP_PARENT))

    return NotionTaskProjection(
        id=page.get("id", ""),
        title=title or "(untitled)",
        status=status,
        priority=priority,
        project=project,
        due=due,
        notes=notes,
        parentId=parent_id,
        url=page.get("url", ""),
        createdTime=page.get("created_time", ""),
        lastEditedTime=page.get("last_edited_time", ""),
    )
