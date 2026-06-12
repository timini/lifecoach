"""Build a project-bucketed, parent-nested task tree from a flat list
of NotionTaskProjections.

Shape returned: NotionTaskTree (see contracts/models.py). The tree is
constructed in two passes:

  Pass 1 — index every task by id so parent lookups are O(1).
  Pass 2 — walk the list once; if a task has a parentId AND that parent
           is in the index AND is non-Done, attach it as a child of
           the parent's NotionTaskNode. Otherwise it surfaces at the
           top level under its Project bucket (or '(no project)').

Done tasks are filtered out before tree construction — the review is
about what's OPEN. Done lives in Notion's archive for forensic recall;
the agent uses notion_review_tasks(filter) for any "show me what I
finished last week" query.
"""

from __future__ import annotations

from datetime import UTC, datetime

from lifecoach_agent.contracts.models import (
    NotionTaskNode,
    NotionTaskProjection,
    NotionTaskTree,
)

ORPHAN_PROJECT_KEY = "(no project)"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def build_task_tree(
    pages: list[NotionTaskProjection],
    *,
    now_iso: str | None = None,
) -> NotionTaskTree:
    """Group `pages` by Project (top level), nest by Parent item
    relation. Done tasks are filtered out."""
    open_tasks = [t for t in pages if t.status != "Done"]

    # Pass 1: index every open task by id. Build a NotionTaskNode per
    # task so parent-attach is just a list.append on the parent node.
    nodes: dict[str, NotionTaskNode] = {
        t.id: NotionTaskNode(task=t, children=[]) for t in open_tasks
    }

    # Pass 2: classify each node as top-level (under a project bucket)
    # or child-of-another-node. A node is a child iff its parentId is
    # in the open-task index — pointing at a Done parent or an alien
    # id surfaces it as top-level so it doesn't disappear from view.
    top_level: dict[str, list[NotionTaskNode]] = {}
    for node in nodes.values():
        parent_id = node.task.parentId
        # `parent_id != node.task.id` guards a self-pointing parent (a Notion
        # data glitch / manual API write) — attaching a node to itself would
        # make model_dump recurse forever.
        if parent_id and parent_id != node.task.id and parent_id in nodes:
            nodes[parent_id].children.append(node)
            continue
        bucket = node.task.project or ORPHAN_PROJECT_KEY
        top_level.setdefault(bucket, []).append(node)

    return NotionTaskTree(
        generatedAt=now_iso or _now_iso(),
        projects=top_level,
        totalOpen=len(open_tasks),
    )
