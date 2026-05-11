"""`triage_inbox` AgentTool. Wraps a dedicated `triage_inbox`-named
sub-agent (own LlmAgent instance, same tools, custom instruction scoped
to the triage flow). Main agent invokes it and gets back a
`<TRIAGE_REPORT>{json}</TRIAGE_REPORT>` blob the wrapper parses out.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from google.adk.tools.agent_tool import AgentTool
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from lifecoach_agent.contracts.models import TriageReport
from lifecoach_agent.workspace_agent.agent import create_workspace_agent
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

TRIAGE_INBOX_TOOL_NAME = "triage_inbox"

_TRIAGE_DESCRIPTION = (
    "Use when the user is starting their day or asks to triage their inbox. "
    "Returns a structured triage report classifying messages into "
    "noise/actions/events/info buckets. Read-only — does NOT archive or "
    "modify anything; the parent agent calls archive_messages after the user "
    "confirms."
)

TRIAGE_INBOX_INSTRUCTION = """You are the inbox-triage sub-agent for a coaching assistant.

The parent will hand you a JSON message with an optional `since` key (Gmail-style window like "1d" / "12h"; default "1d").

Procedure:
1. Call list_inbox with the since value (e.g. since="1d") to get message ids + snippets.
2. For each message, call get_message with the id (e.g. id=<the id from step 1>) to read the decoded body and headers. Parallel calls are fine.
3. Classify EVERY message into exactly one bucket:
   - noise: newsletters, automated reports, marketing — no action
   - actions: the user must do something — distil into a 1-line task
   - events: a meeting/appointment with date+time — propose start/end
   - info: factual updates touching a known goal/profile fact — short note

For events with a clear date+time, infer proposedStart (RFC3339 with timezone) and proposedEnd if known. Default duration 30 min.

DO NOT call any write tools. The parent agent owns confirmations and writes.

Final answer: emit ONLY a single line of the form
<TRIAGE_REPORT>...minified JSON object with keys noise, actions, events, info, each an array...</TRIAGE_REPORT>
matching this schema:
- noise:   id, threadId?, from, subject
- actions: id, threadId?, from, subject, task
- events:  id, threadId?, subject, proposedStart, proposedEnd?, location?
- info:    id, threadId?, from, subject, note

Be terse. The parent agent will paraphrase."""


class TriageInboxInput(BaseModel):
    """Input schema the AgentTool hands to the sub-agent. ADK populates
    this from the LLM's tool args; the sub-agent's instruction reads
    `since` out of the JSON it receives."""

    model_config = ConfigDict(extra="forbid")

    since: str | None = Field(
        default=None,
        description='Gmail-style relative window (e.g. "1d", "12h", "3d"). Default "1d".',
    )


@dataclass(frozen=True)
class TriageInboxToolResult:
    status: str  # "ok" or "parse_error"
    raw: str
    report: TriageReport | None = None


def create_triage_inbox_tool(deps: WorkspaceToolDeps) -> AgentTool:
    agent = create_workspace_agent(
        deps=deps,
        name=TRIAGE_INBOX_TOOL_NAME,
        description=_TRIAGE_DESCRIPTION,
        instruction=TRIAGE_INBOX_INSTRUCTION,
        input_schema=TriageInboxInput,
    )
    return AgentTool(agent=agent, skip_summarization=False)


_MARKER_RE = re.compile(r"<TRIAGE_REPORT>([\s\S]*?)</TRIAGE_REPORT>")


def parse_triage_report(text: str) -> TriageInboxToolResult:
    """Parse the sub-agent's free-text answer into a validated
    TriageReport. On parse-miss returns status='parse_error' so the
    parent agent can fall back to narrating the raw text."""
    match = _MARKER_RE.search(text)
    if not match:
        return TriageInboxToolResult(status="parse_error", raw=text)
    inner = match.group(1).strip()
    try:
        parsed: Any = json.loads(inner)
    except json.JSONDecodeError:
        return TriageInboxToolResult(status="parse_error", raw=text)
    try:
        report = TriageReport.model_validate(parsed)
    except ValidationError:
        return TriageInboxToolResult(status="parse_error", raw=text)
    return TriageInboxToolResult(status="ok", report=report, raw=text)
