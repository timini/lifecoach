"""Stub agent module for the **triage_inbox** sub-agent (Tier-1 evals).

Where `tests.evals.eval_agent` registers the main coach agent, this
module registers the workspace sub-agent that the `triage_inbox`
AgentTool wraps. Tier-1 evals point at it via `agent_module=` so the
sub-agent's classification logic runs end-to-end against real Gemini,
with `list_inbox` + `get_message` short-circuited by canned responses.

Mocked visible inbox covers all four buckets the sub-agent classifies into:

  - m1: newsletter        → noise
  - m2: action email      → actions (1-line task distilled)
  - m3: event invite      → events (proposedStart inferred)
  - m4: info update       → info (touches a known profile fact)

The sub-agent's `before_tool_callback` inspects args and routes to the
right canned response. The list response deliberately includes a duplicate
summary for m2, so the model must still walk through one `list_inbox` +
four distinct `get_message` calls before emitting the
<TRIAGE_REPORT>{json}</TRIAGE_REPORT> blob the eval asserts on.
"""

from __future__ import annotations

from typing import Any

from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

from lifecoach_agent.contracts.models import MessageProjection
from lifecoach_agent.workspace_agent.agent import create_workspace_agent
from lifecoach_agent.workspace_agent.agent_tools.triage_inbox import (
    TRIAGE_INBOX_INSTRUCTION,
    TRIAGE_INBOX_TOOL_NAME,
    TriageInboxInput,
)
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps

# Mocked inbox — id → list_inbox summary + full message projection.
# Body text is intentionally vivid enough that classification is
# unambiguous even for a smaller model.
_INBOX: list[dict[str, Any]] = [
    {
        "id": "m1",
        "threadId": "t1",
        "from": "Substack Weekly <newsletter@substack.com>",
        "subject": "Your weekly digest — 12 stories",
        "snippet": "Top stories this week: AI breakthroughs, market roundup, ...",
        "body": (
            "Hi,\n\nHere are this week's top picks across your subscriptions:\n"
            "1. The AI boom continues...\n2. Market roundup...\n3. New from..."
            "\n\nUnsubscribe at any time."
        ),
    },
    {
        "id": "m2",
        "threadId": "t2",
        "from": "Alex <alex@studio.example>",
        "subject": "Contract renewal — needs your sign-off this week",
        "snippet": "Hey — the contract renewal for next quarter is ready...",
        "body": (
            "Hey,\n\nThe renewal contract is ready for sign-off. Could you "
            "review and sign by Friday? Standard terms, no surprises. "
            "Document is at the usual SharePoint location.\n\nThanks,\nAlex"
        ),
    },
    {
        "id": "m3",
        "threadId": "t3",
        "from": "Sarah <sarah@example.com>",
        "subject": "Lunch Tuesday 12:30?",
        "snippet": "Want to grab lunch Tuesday around 12:30 at Tortilla?...",
        "body": (
            "Hi!\n\nWant to grab lunch Tuesday 12 May at 12:30 at Tortilla "
            "in Soho? Have a few project ideas I'd love to run by you.\n\n"
            "Let me know — Sarah"
        ),
    },
    {
        "id": "m4",
        "threadId": "t4",
        "from": "Greenfield Primary <admin@greenfield.school>",
        "subject": "Maya — school photo day Friday",
        "snippet": "Reminder that school photo day for Year 3 is this Friday...",
        "body": (
            "Dear Parent,\n\nThis is a reminder that school photo day for "
            "Year 3 is this Friday 15 May. Maya should wear school uniform "
            "(no PE kit). No action needed from you — just a heads up.\n\n"
            "Best,\nGreenfield admin"
        ),
    },
]


def _list_inbox_response() -> dict[str, Any]:
    return {
        "status": "ok",
        "messages": [
            *[{"id": m["id"], "threadId": m["threadId"], "snippet": m["snippet"]} for m in _INBOX],
            {
                "id": "m2",
                "threadId": "t2",
                "snippet": "Duplicate summary that must not trigger a second read",
            },
        ],
    }


def _get_message_response(message_id: str) -> dict[str, Any]:
    for m in _INBOX:
        if m["id"] != message_id:
            continue
        proj = MessageProjection.model_validate(
            {
                "id": m["id"],
                "threadId": m["threadId"],
                "from": m["from"],
                "subject": m["subject"],
                "date": "Mon, 11 May 2026 09:00:00 +0100",
                "snippet": m["snippet"],
                "body": m["body"],
                "truncated": False,
            }
        )
        return {
            "status": "ok",
            "message": proj.model_dump(by_alias=True, exclude_none=True),
        }
    return {"status": "error", "code": "not_found", "message": f"unknown id {message_id}"}


def _stub_before_tool(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
) -> Any | None:
    """Route stubs to the right canned response by tool name + args."""
    name = getattr(tool, "name", None) or tool.__class__.__name__
    if name == "list_inbox":
        return _list_inbox_response()
    if name == "get_message":
        mid = args.get("id") if isinstance(args, dict) else None
        if isinstance(mid, str):
            return _get_message_response(mid)
        return {"status": "error", "code": "bad_request", "message": "missing id"}
    # search_messages / list_events / list_tasks not exercised by this
    # eval; return generic empty success so a stray call doesn't error.
    if name in {"search_messages", "list_events", "list_tasks"}:
        return {"status": "ok", "items": [], "messages": [], "events": [], "tasks": []}
    return None


class _FakeTokensStore:
    """Just enough of `WorkspaceTokensStore` for `create_workspace_agent`
    to wire up — the stub tool callback intercepts before any real call
    reaches `run_gws`, so the store is never asked for a token."""

    async def get_valid_access_token(self, uid: str) -> str:
        return "stub-token"

    async def delete(self, uid: str) -> None:
        return None


def _build_eval_root_agent() -> Any:
    deps = WorkspaceToolDeps(store=_FakeTokensStore(), uid="eval-triage-uid")  # type: ignore[arg-type]
    agent = create_workspace_agent(
        deps=deps,
        name=TRIAGE_INBOX_TOOL_NAME,
        description="Triage inbox sub-agent (eval).",
        instruction=TRIAGE_INBOX_INSTRUCTION,
        input_schema=TriageInboxInput,
    )
    agent.before_tool_callback = _stub_before_tool
    return agent


# AgentEvaluator loads `root_agent` from this module.
root_agent = _build_eval_root_agent()
