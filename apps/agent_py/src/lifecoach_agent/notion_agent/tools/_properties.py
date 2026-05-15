"""Helpers for building Notion's wire-format property payloads.

Write tools build a partial `properties` dict to pass to Notion's
`pages.create` / `pages.update` endpoints. Each property type has its
own envelope shape; this module hides those wrappers so the tool code
can read `set_title("ship the auth fix")` instead of inline-building
the JSON each time.
"""

from __future__ import annotations

from typing import Any

PROP_TITLE = "Task"
PROP_STATUS = "Status"
PROP_PRIORITY = "Priority"
PROP_PROJECT = "Project"
PROP_DUE = "Due Date"
PROP_NOTES = "Notes"
PROP_PARENT = "Parent item"


def title_property(text: str) -> dict[str, Any]:
    return {"title": [{"type": "text", "text": {"content": text}}]}


def rich_text_property(text: str) -> dict[str, Any]:
    return {"rich_text": [{"type": "text", "text": {"content": text}}]}


def select_property(name: str | None) -> dict[str, Any]:
    if name is None:
        return {"select": None}
    return {"select": {"name": name}}


def date_property(start: str | None) -> dict[str, Any]:
    if start is None:
        return {"date": None}
    return {"date": {"start": start}}


def relation_property(ids: list[str] | None) -> dict[str, Any]:
    return {"relation": [{"id": i} for i in (ids or [])]}
