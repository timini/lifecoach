"""`notion_review_tasks` AgentTool — the main-agent surface for the
Notion sub-agent.

Wraps a dedicated sub-agent. For now stock AgentTool; will swap to
BridgedAgentTool once that lands on main (open in PR #100 / #101 /
#102 at time of writing). With the bridge in place the chat UI shows
the sub-agent's internal list_tasks / get_task / search_tasks calls
as nested badges; without it, those inner calls are consumed silently
and the parent only sees the final review report.

The sub-agent's instruction tells it to emit
`<NOTION_REVIEW>{minified JSON tree}</NOTION_REVIEW>`. We parse that
marker on the way out, validate it against NotionTaskTree, and pass
the structured tree back to the parent. On parse-miss the wrapper
returns `status='parse_error'` with the raw text so the parent can
narrate.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from google.adk.tools.agent_tool import AgentTool
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from lifecoach_agent.contracts.models import NotionTaskTree
from lifecoach_agent.notion_agent.agent import create_notion_agent
from lifecoach_agent.notion_agent.tools._deps import NotionToolDeps

# TODO: swap to BridgedAgentTool once PR #100 / #101 / #102 lands on
# main. The bridge surfaces the sub-agent's internal list_tasks /
# get_task / search_tasks calls as nested badges in the chat UI; until
# the bridge merges, stock AgentTool consumes those inner events.

NOTION_REVIEW_TASKS_TOOL_NAME = "notion_review_tasks"

_REVIEW_DESCRIPTION = (
    "Use when the user wants to see their open tasks — 'what's on my plate', "
    "'morning planning', 'show me my list', weekly review. Returns a "
    "project-bucketed, parent-nested tree of OPEN tasks (everything not Done). "
    "Optional `filter` is a natural-language constraint ('high priority', 'this "
    "week', 'just Apollo project') the sub-agent uses to narrow the read. "
    "Read-only; the parent calls add_/update_/complete_notion_task as separate "
    "writes after."
)

NOTION_REVIEW_INSTRUCTION = """You are the Notion task-review sub-agent.

The parent will hand you a JSON message with an optional `filter` key — a
natural-language constraint like "high priority", "due this week", "just
project Apollo", or empty for everything.

Procedure:
1. Call list_tasks(status="open", limit=100) to get the user's open tasks
   (To Do / In Progress / Waiting).
2. If `filter` is set, optionally call search_tasks(query="<keyword>") to
   refine, or apply the filter mentally when building the tree.
3. Apply any priority/due/project filters from the user's query yourself —
   the listing already includes priority, project, and due fields.
4. Build a NotionTaskTree:
   - Bucket tasks by their Project select value (top-level keys in
     `projects`).
   - Orphan tasks (no project) live under "(no project)".
   - Within each bucket, nest tasks under their parents using the
     `parentId` field — a parent task with sub-tasks shows as
     {task: {...}, children: [{task: ..., children: [...]}]}.
   - Compute `totalOpen` as the total count across the tree.
   - Set `generatedAt` to the current ISO timestamp.

DO NOT call any write tools. You don't have write tools.

Final answer: emit ONLY a single line of the form
<NOTION_REVIEW>...minified JSON object matching NotionTaskTree...</NOTION_REVIEW>

Schema for NotionTaskTree:
  generatedAt: string (ISO 8601)
  projects: { [project_name: string]: NotionTaskNode[] }
  totalOpen: integer

NotionTaskNode:
  task: NotionTaskProjection { id, title, status, priority?, project?,
                               due?, notes?, parentId?, url, createdTime,
                               lastEditedTime }
  children: NotionTaskNode[]

Be terse. The parent will paraphrase what you return."""


class NotionReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filter: str | None = Field(
        default=None,
        description=(
            "Natural-language constraint: 'high priority', 'due this week', "
            "'just project Apollo'. Omit for everything."
        ),
    )


@dataclass(frozen=True)
class NotionReviewToolResult:
    status: str  # "ok" or "parse_error"
    raw: str
    tree: NotionTaskTree | None = None


def create_notion_review_tasks_tool(deps: NotionToolDeps) -> AgentTool:
    """Build the AgentTool. Swap to BridgedAgentTool once the bridge
    lands on main so the chat UI sees the sub-agent's internal
    list/get/search calls as nested badges under the parent's
    notion_review_tasks badge."""
    agent = create_notion_agent(
        deps=deps,
        name=NOTION_REVIEW_TASKS_TOOL_NAME,
        description=_REVIEW_DESCRIPTION,
        instruction=NOTION_REVIEW_INSTRUCTION,
        input_schema=NotionReviewInput,
    )
    return AgentTool(agent=agent, skip_summarization=False)


_MARKER_RE = re.compile(r"<NOTION_REVIEW>([\s\S]*?)</NOTION_REVIEW>")


def parse_notion_review_report(text: str) -> NotionReviewToolResult:
    """Parse the sub-agent's free-text answer into a validated
    NotionTaskTree. Returns status='parse_error' with the raw text on
    any failure so the parent agent can fall back to narrating."""
    match = _MARKER_RE.search(text)
    if not match:
        return NotionReviewToolResult(status="parse_error", raw=text)
    inner = match.group(1).strip()
    try:
        parsed: Any = json.loads(inner)
    except json.JSONDecodeError:
        return NotionReviewToolResult(status="parse_error", raw=text)
    try:
        tree = NotionTaskTree.model_validate(parsed)
    except ValidationError:
        return NotionReviewToolResult(status="parse_error", raw=text)
    return NotionReviewToolResult(status="ok", tree=tree, raw=text)
