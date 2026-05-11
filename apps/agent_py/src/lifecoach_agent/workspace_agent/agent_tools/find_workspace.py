"""`find_workspace` AgentTool — ad-hoc lookup across Gmail / Calendar /
Tasks. Wraps a dedicated `find_workspace`-named LlmAgent instance with
a search-flavoured instruction. Returns natural-language text plus
resource ids (so the parent can act on them).
"""

from __future__ import annotations

from google.adk.tools.agent_tool import AgentTool
from pydantic import BaseModel, ConfigDict, Field

from lifecoach_agent.workspace_agent.agent import create_workspace_agent
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

FIND_WORKSPACE_TOOL_NAME = "find_workspace"

_FIND_DESCRIPTION = (
    "Use to look up specific information across the user's Gmail / Calendar / "
    "Tasks (e.g. \"Sarah's email last week\", \"what's on Thursday afternoon\", "
    '"open tasks for the project review"). Do NOT use for inbox triage — call '
    "triage_inbox for that. Returns a natural-language answer with relevant "
    "ids/links. Read-only."
)

_FIND_INSTRUCTION = """You are the workspace-search sub-agent for a coaching assistant.

The parent will hand you a JSON message of the form {"query":"..."} — parse it and treat the "query" string as a natural-language request asking for specific information across Gmail, Calendar, and Google Tasks.

Procedure:
1. Pick the right read tool(s):
   - Gmail content / threads: search_messages with Gmail query syntax (from:, subject:, newer_than:, label:starred, etc).
   - Specific message body: get_message with the id.
   - Calendar in a window: list_events with timeMin/timeMax (RFC3339).
   - Tasks: list_tasks (showCompleted as needed).
2. Use as few tool calls as possible. If a single search/list answers the question, stop there.
3. Do NOT call any write tools. The parent agent owns confirmations and writes.

Final answer: a short natural-language answer (≤4 sentences) that:
- Cites each fact with a resource id in brackets, e.g. "Sarah confirmed lunch on Tuesday [m:18a4f1b] and the parent-teacher slot is 6pm [ev:4kr2…]."
- If you used calendar/event ids, prefix with "ev:". For message ids, prefix with "m:". For task ids, "t:".
- If the answer is "nothing matched", say so directly.

Be terse. The parent agent will paraphrase."""


class FindWorkspaceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(
        min_length=1,
        description=(
            'Natural-language question — e.g. "Sarah\'s email last week", '
            '"what\'s Thursday afternoon".'
        ),
    )


def create_find_workspace_tool(deps: WorkspaceToolDeps) -> AgentTool:
    agent = create_workspace_agent(
        deps=deps,
        name=FIND_WORKSPACE_TOOL_NAME,
        description=_FIND_DESCRIPTION,
        instruction=_FIND_INSTRUCTION,
        input_schema=FindWorkspaceInput,
    )
    return AgentTool(agent=agent, skip_summarization=False)
