"""Tests for Notion projections: page → flat task, list → tree."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.contracts.models import NotionTaskProjection
from lifecoach_agent.notion_agent.projections import (
    build_task_tree,
    project_notion_task,
)


def _page(
    *,
    id: str = "p-1",  # noqa: A002 — matches Notion's field name
    title: str = "Ship the auth fix",
    status: str | None = "To Do",
    priority: str | None = "High",
    project: str | None = "Apollo",
    due: str | None = "2026-05-30",
    notes: str | None = "started",
    parent_id: str | None = None,
) -> dict[str, Any]:
    """Build a Notion page object with the property shapes the bootstrap
    creates. Helps the tests read close to the wire format."""
    props: dict[str, Any] = {
        "Task": {"title": [{"plain_text": title}]},
        "Status": {"select": {"name": status}} if status else {"select": None},
        "Priority": {"select": {"name": priority}} if priority else {"select": None},
        "Project": {"select": {"name": project}} if project else {"select": None},
        "Due Date": {"date": {"start": due}} if due else {"date": None},
        "Notes": ({"rich_text": [{"plain_text": notes}]} if notes else {"rich_text": []}),
        "Parent item": ({"relation": [{"id": parent_id}]} if parent_id else {"relation": []}),
    }
    return {
        "id": id,
        "url": f"https://www.notion.so/{id}",
        "created_time": "2026-05-14T00:00:00.000Z",
        "last_edited_time": "2026-05-14T00:00:00.000Z",
        "properties": props,
    }


# --- project_notion_task ----------------------------------------------------


def test_projection_extracts_all_known_properties() -> None:
    out = project_notion_task(_page())
    assert out.id == "p-1"
    assert out.title == "Ship the auth fix"
    assert out.status == "To Do"
    assert out.priority == "High"
    assert out.project == "Apollo"
    assert out.due == "2026-05-30"
    assert out.notes == "started"
    assert out.parentId is None
    assert out.url == "https://www.notion.so/p-1"


def test_projection_falls_back_when_status_is_missing() -> None:
    out = project_notion_task(_page(status=None))
    # Default to "To Do" rather than crashing — single mistyped row
    # shouldn't block a whole review.
    assert out.status == "To Do"


def test_projection_drops_unknown_priority_value() -> None:
    page = _page(priority="P0")  # not in our literal
    out = project_notion_task(page)
    assert out.priority is None


def test_projection_uses_name_title_fallback() -> None:
    """Users who created their own DB before our bootstrap may have a
    'Name' title prop instead of 'Task'."""
    page = _page()
    # Remove "Task" and add "Name" — Notion's default title key.
    props = page["properties"]
    del props["Task"]
    props["Name"] = {"title": [{"plain_text": "Alternative title"}]}
    out = project_notion_task(page)
    assert out.title == "Alternative title"


def test_projection_returns_untitled_when_no_title_anywhere() -> None:
    page = _page()
    page["properties"]["Task"] = {"title": []}
    out = project_notion_task(page)
    assert out.title == "(untitled)"


def test_projection_accepts_notion_status_type_as_alternative() -> None:
    """Notion has both a `select` and a built-in `status` property type.
    The external repo's prompt-mining notes flagged this — handle both."""
    page = _page(status="In Progress")
    page["properties"]["Status"] = {"status": {"name": "In Progress"}}
    out = project_notion_task(page)
    assert out.status == "In Progress"


def test_projection_carries_parent_id_when_set() -> None:
    out = project_notion_task(_page(parent_id="parent-1"))
    assert out.parentId == "parent-1"


def test_projection_handles_completely_empty_properties() -> None:
    out = project_notion_task(
        {"id": "x", "url": "u", "created_time": "", "last_edited_time": "", "properties": {}}
    )
    assert out.id == "x"
    assert out.status == "To Do"  # safe default
    assert out.priority is None
    assert out.project is None


# --- build_task_tree --------------------------------------------------------


def _proj(
    *,
    id: str,  # noqa: A002
    project: str | None = None,
    status: str = "To Do",
    parent_id: str | None = None,
    title: str = "",
) -> NotionTaskProjection:
    return NotionTaskProjection(
        id=id,
        title=title or id,
        status=status,  # type: ignore[arg-type]
        project=project,
        parentId=parent_id,
        url=f"https://www.notion.so/{id}",
        createdTime="2026-05-14T00:00:00Z",
        lastEditedTime="2026-05-14T00:00:00Z",
    )


def test_tree_groups_by_project_and_nests_children() -> None:
    pages = [
        _proj(id="p1", project="Apollo"),
        _proj(id="p1-a", project="Apollo", parent_id="p1"),
        _proj(id="p1-b", project="Apollo", parent_id="p1"),
        _proj(id="p2", project="Mercury"),
    ]
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    assert tree.totalOpen == 4
    apollo = tree.projects["Apollo"]
    mercury = tree.projects["Mercury"]
    assert len(apollo) == 1
    assert apollo[0].task.id == "p1"
    assert {n.task.id for n in apollo[0].children} == {"p1-a", "p1-b"}
    assert len(mercury) == 1


def test_tree_filters_out_done_tasks() -> None:
    pages = [
        _proj(id="p1", status="To Do"),
        _proj(id="p2", status="Done"),
        _proj(id="p3", status="In Progress"),
    ]
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    assert tree.totalOpen == 2
    open_ids = {n.task.id for v in tree.projects.values() for n in v}
    assert open_ids == {"p1", "p3"}


def test_tree_orphans_under_no_project_bucket() -> None:
    pages = [_proj(id="p1"), _proj(id="p2")]  # both project=None
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    assert list(tree.projects.keys()) == ["(no project)"]
    assert {n.task.id for n in tree.projects["(no project)"]} == {"p1", "p2"}


def test_tree_child_pointing_at_done_parent_surfaces_top_level() -> None:
    """If a parent is Done, we filter it out (tree only carries open
    tasks) — its still-open children should surface at the top of
    their Project bucket rather than vanishing under a missing parent."""
    pages = [
        _proj(id="parent-done", status="Done", project="Apollo"),
        _proj(id="orphan-child", project="Apollo", parent_id="parent-done"),
    ]
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    apollo = tree.projects["Apollo"]
    assert len(apollo) == 1
    assert apollo[0].task.id == "orphan-child"
    assert apollo[0].children == []


def test_tree_self_parent_does_not_recurse() -> None:
    """A task whose parentId points at itself (a Notion data glitch) must
    NOT be attached to its own children list — that would make model_dump
    recurse forever. It surfaces as a normal top-level task instead."""
    pages = [_proj(id="loop", project="Apollo", parent_id="loop")]
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    apollo = tree.projects["Apollo"]
    assert len(apollo) == 1
    assert apollo[0].task.id == "loop"
    assert apollo[0].children == []
    # Serialisation must complete without a RecursionError.
    assert tree.model_dump_json()


def test_tree_deep_three_level_nesting() -> None:
    """Notion relations allow arbitrary depth. The tree must recurse."""
    pages = [
        _proj(id="root", project="Big"),
        _proj(id="mid", project="Big", parent_id="root"),
        _proj(id="leaf", project="Big", parent_id="mid"),
    ]
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    big = tree.projects["Big"]
    assert len(big) == 1
    assert big[0].task.id == "root"
    assert big[0].children[0].task.id == "mid"
    assert big[0].children[0].children[0].task.id == "leaf"


def test_tree_round_trips_via_pydantic_serialization() -> None:
    """The sub-agent emits the tree as minified JSON inside a
    <NOTION_REVIEW> marker; the parser then NotionTaskTree-validates.
    Verify the round trip works even on a 3-level nested shape."""
    pages = [
        _proj(id="root", project="Big"),
        _proj(id="mid", project="Big", parent_id="root"),
        _proj(id="leaf", project="Big", parent_id="mid"),
    ]
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    payload = tree.model_dump_json()
    from lifecoach_agent.contracts.models import NotionTaskTree

    parsed = NotionTaskTree.model_validate_json(payload)
    assert parsed.totalOpen == 3
    assert parsed.projects["Big"][0].children[0].children[0].task.id == "leaf"


@pytest.mark.parametrize("project", ["", None])
def test_tree_treats_empty_project_as_orphan(project: str | None) -> None:
    pages = [_proj(id="p1", project=project)]
    tree = build_task_tree(pages, now_iso="2026-05-14T00:00:00Z")
    assert "(no project)" in tree.projects
