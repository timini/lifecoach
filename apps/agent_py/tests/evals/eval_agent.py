"""Stub agent module used by Tier-1 evals.

The eval framework imports this module and constructs an `Agent` from
`root_agent`. We register the same root agent shape the production
`server.py` does, but every external dependency is stubbed:

- Tools have a `before_tool_callback` that returns canned responses
  keyed by `(tool_name, args)`.
- The HTTP-based context fetchers are not invoked (the prompt builder
  receives an `InstructionContext` with all fetch-derived fields set
  to None / empty).

The model (Gemini) is still called by the runner — Tier 1 is "all I/O
stubbed", not "model stubbed". See `README.md` for the trade-off and
when to run `just eval-real` instead.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from google.adk.agents import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

from lifecoach_agent.agent import build_root_agent_for
from lifecoach_agent.context.memory import noop_memory_client
from lifecoach_agent.prompt.build_instruction import InstructionContext
from lifecoach_agent.tools.ask_choice import (
    create_ask_multiple_choice_tool,
    create_ask_single_choice_tool,
)


def _morning_triage_tool_stubs() -> dict[str, Any]:
    """Canned `(tool_name, args)` → response responses for the
    morning_triage_full_flow case."""
    return {
        "call_workspace": {
            "status": "ok",
            "body": {
                "messages": [
                    {"id": "m1"},
                    {"id": "m2"},
                    {"id": "m3"},
                ],
                "resultSizeEstimate": 3,
            },
        },
        "ask_single_choice_question": {
            "status": "shown",
            "kind": "single",
            "question": "Archive these 3?",
            "options": ["Yes, archive", "Skip"],
        },
        "update_user_profile": {
            "status": "ok",
            "updated_path": "practices.day_planning.last_planned_date",
            "new_value": "2026-05-12",
        },
        "log_goal_update": {"status": "ok"},
    }


_STUBS = _morning_triage_tool_stubs()


def _stub_before_tool(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
) -> Any | None:
    """ADK `before_tool_callback`. Returning a non-None value
    short-circuits the actual tool call and the model sees the value
    as the tool's response. Used in evals so we don't need real
    Workspace / Firestore."""
    name = getattr(tool, "name", None) or tool.__class__.__name__
    canned = _STUBS.get(name)
    if canned is None:
        return None
    return canned


def _build_instruction_ctx(now: datetime) -> InstructionContext:
    return InstructionContext(
        now=now,
        timezone="Europe/London",
        user_state="workspace_connected",
        memory_enabled=False,
    )


def _build_eval_root_agent() -> Agent:
    """Build the root agent for evals. Tools are the choice tools and a
    minimal call_workspace shim — every tool's actual side effect is
    short-circuited by `_stub_before_tool`. The model still emits the
    same call shape so trajectory evaluators work."""
    now = datetime(2026, 5, 12, 9, 0, tzinfo=ZoneInfo("Europe/London"))
    ctx = _build_instruction_ctx(now)
    # Use an in-eval call_workspace stub: a callable with the right name
    # and signature, no real I/O. The before_tool_callback intercepts.
    from google.adk.tools import FunctionTool

    async def call_workspace(
        service: str, resource: str, method: str, params: str | None = None
    ) -> dict[str, Any]:
        """Generic Google Workspace dispatch — eval stub. The real
        body is short-circuited by `before_tool_callback`."""
        return {"status": "stubbed"}

    tools: list[Any] = [
        FunctionTool(call_workspace),
        create_ask_single_choice_tool(),
        create_ask_multiple_choice_tool(),
    ]
    agent = build_root_agent_for(ctx, tools)
    agent.before_tool_callback = _stub_before_tool
    return agent


# AgentEvaluator imports `root_agent` from this module via
# `agent_module="tests.evals.eval_agent"`.
root_agent: Agent = _build_eval_root_agent()


# Suppress unused import warnings for `noop_memory_client` /
# `CallbackContext` — they're imported here so future cases that need
# them don't have to chase the right import path.
_ = noop_memory_client, CallbackContext
