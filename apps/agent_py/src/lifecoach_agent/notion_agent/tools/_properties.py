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

# Notion rejects any single rich_text / title element whose `text.content`
# exceeds 2000 characters (HTTP 400). Append-mode notes accumulate well past
# that, so split long text across multiple elements — Notion concatenates
# them, so no content is lost.
_NOTION_TEXT_ELEMENT_LIMIT = 2000


def _text_elements(text: str) -> list[dict[str, Any]]:
    if not text:
        return [{"type": "text", "text": {"content": ""}}]
    return [
        {"type": "text", "text": {"content": text[i : i + _NOTION_TEXT_ELEMENT_LIMIT]}}
        for i in range(0, len(text), _NOTION_TEXT_ELEMENT_LIMIT)
    ]


def title_property(text: str) -> dict[str, Any]:
    return {"title": _text_elements(text)}


def rich_text_property(text: str) -> dict[str, Any]:
    return {"rich_text": _text_elements(text)}


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
