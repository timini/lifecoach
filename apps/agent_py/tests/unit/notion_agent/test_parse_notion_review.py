"""Tests for the <NOTION_REVIEW>...</NOTION_REVIEW> marker parse."""

from __future__ import annotations

import json

from lifecoach_agent.contracts.models import (
    NotionTaskNode,
    NotionTaskProjection,
    NotionTaskTree,
)
from lifecoach_agent.notion_agent.agent_tools.notion_review_tasks import (
    parse_notion_review_report,
)


def _sample_tree() -> NotionTaskTree:
    """A representative minified tree (one project, one parent + child)."""
    parent = NotionTaskProjection(
        id="p1",
        title="Ship the auth fix",
        status="In Progress",
        project="Apollo",
        priority="High",
        url="https://www.notion.so/p1",
        createdTime="2026-05-14T00:00:00Z",
        lastEditedTime="2026-05-14T00:00:00Z",
    )
    child = NotionTaskProjection(
        id="p1-a",
        title="Decide OIDC vs OAuth",
        status="To Do",
        project="Apollo",
        parentId="p1",
        url="https://www.notion.so/p1-a",
        createdTime="2026-05-14T00:00:00Z",
        lastEditedTime="2026-05-14T00:00:00Z",
    )
    return NotionTaskTree(
        generatedAt="2026-05-14T10:00:00Z",
        projects={"Apollo": [NotionTaskNode(task=parent, children=[NotionTaskNode(task=child)])]},
        totalOpen=2,
    )


def test_parse_success_round_trips_tree() -> None:
    tree = _sample_tree()
    blob = tree.model_dump_json()
    text = f"Some preamble.\n<NOTION_REVIEW>{blob}</NOTION_REVIEW>\nSome suffix."
    out = parse_notion_review_report(text)
    assert out.status == "ok"
    assert out.tree is not None
    assert out.tree.totalOpen == 2
    assert out.tree.projects["Apollo"][0].task.id == "p1"
    assert out.tree.projects["Apollo"][0].children[0].task.id == "p1-a"


def test_parse_returns_parse_error_when_no_marker() -> None:
    out = parse_notion_review_report("I couldn't find any tasks open today.")
    assert out.status == "parse_error"
    assert out.tree is None
    assert "I couldn't find" in out.raw


def test_parse_returns_parse_error_on_invalid_json() -> None:
    text = "<NOTION_REVIEW>{this is not valid json}</NOTION_REVIEW>"
    out = parse_notion_review_report(text)
    assert out.status == "parse_error"
    assert out.tree is None


def test_parse_returns_parse_error_on_schema_violation() -> None:
    """JSON that parses but does not match NotionTaskTree (missing
    required fields) surfaces as parse_error."""
    bad = json.dumps({"generatedAt": "2026-05-14T00:00:00Z"})  # missing projects, totalOpen
    text = f"<NOTION_REVIEW>{bad}</NOTION_REVIEW>"
    out = parse_notion_review_report(text)
    assert out.status == "parse_error"


def test_parse_picks_first_marker_when_multiple_present() -> None:
    """If the sub-agent fumbles and emits two markers, take the first
    (matches workspace's TRIAGE_REPORT behaviour)."""
    a = _sample_tree()
    b = _sample_tree()
    text = (
        f"<NOTION_REVIEW>{a.model_dump_json()}</NOTION_REVIEW>"
        f"<NOTION_REVIEW>{b.model_dump_json()}</NOTION_REVIEW>"
    )
    out = parse_notion_review_report(text)
    assert out.status == "ok"
    assert out.tree is not None


def test_parse_handles_extra_whitespace_inside_marker() -> None:
    tree = _sample_tree()
    blob = tree.model_dump_json()
    text = f"<NOTION_REVIEW>\n  {blob}\n  </NOTION_REVIEW>"
    out = parse_notion_review_report(text)
    assert out.status == "ok"
    assert out.tree is not None
