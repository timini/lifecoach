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


def _tool_stubs() -> dict[str, Any]:
    """Canned `tool_name` → response responses covering every eval-set
    fixture under `fixtures/`. The `before_tool_callback` intercepts at
    invocation time — args don't matter for the trajectory evaluator,
    only the call shape does. We return one shape per tool that's
    plausible enough for the model to keep going.

    Tools that surface a UI directive (`ask_single_choice_question`,
    `connect_workspace`) MUST return a status the choice-detector
    short-circuits on (`shown` / `oauth_prompted`) so the runner ends
    the turn — matches the production server behaviour."""
    return {
        # ---- workspace dispatcher ----
        "call_workspace": {
            "status": "ok",
            "body": {
                "messages": [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}],
                "items": [{"id": "evt-1"}],  # for events.insert / tasks.patch responses
                "resultSizeEstimate": 3,
            },
        },
        # ---- choice tools (turn-ending) ----
        "ask_single_choice_question": {
            "status": "shown",
            "kind": "single",
            "question": "(stubbed)",
            "options": ["Yes", "Skip"],
        },
        "ask_multiple_choice_question": {
            "status": "shown",
            "kind": "multiple",
            "question": "(stubbed)",
            "options": ["a", "b"],
        },
        # ---- workspace UI directives (turn-ending) ----
        "connect_workspace": {"status": "oauth_prompted"},
        "auth_user": {"status": "auth_prompted", "mode": "google"},
        "upgrade_to_pro": {"status": "upgrade_prompted"},
        # ---- profile + goal writes ----
        "update_user_profile": {
            "status": "ok",
            "updated_path": "(stubbed)",
            "new_value": "(stubbed)",
        },
        "log_goal_update": {"status": "ok", "entry": {"goal": "(stubbed)"}},
        "memory_save": {"status": "ok"},
    }


_STUBS = _tool_stubs()


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
    """Use `workspace_connected` as the eval default — the broadest tool
    surface. Cases that test other states (e.g.
    `workspace_disconnected_decline`) override `_lifecoach_user_state`
    in their `session_input.state`; the agent factory still registers
    the full superset of tools, but `before_tool_callback` forces
    deterministic responses regardless."""
    return InstructionContext(
        now=now,
        timezone="Europe/London",
        user_state="workspace_connected",
        memory_enabled=False,
    )


def _build_eval_root_agent() -> Agent:
    """Build the root agent for evals. Registers the full tool surface
    that any of the 6 fixtures exercises; the `before_tool_callback`
    short-circuits actual side effects with canned responses from
    `_tool_stubs()`. The model still emits the same call shape so
    trajectory evaluators work."""
    now = datetime(2026, 5, 12, 9, 0, tzinfo=ZoneInfo("Europe/London"))
    ctx = _build_instruction_ctx(now)

    from google.adk.tools import FunctionTool

    # --- workspace dispatcher stub (covers gmail / calendar / tasks) ----
    async def call_workspace(
        service: str, resource: str, method: str, params: str | None = None
    ) -> dict[str, Any]:
        """Generic Google Workspace dispatch — eval stub. The real
        body is short-circuited by `before_tool_callback`."""
        return {"status": "stubbed"}

    # --- profile / goal / memory write stubs ---------------------------
    async def update_user_profile(path: str, value: str | None) -> dict[str, Any]:
        """Profile write — eval stub."""
        return {"status": "stubbed"}

    async def log_goal_update(
        goal: str, status: str, note: str | None = None
    ) -> dict[str, Any]:
        """Goal-update log — eval stub."""
        return {"status": "stubbed"}

    async def memory_save(text: str) -> dict[str, Any]:
        """Memory save — eval stub."""
        return {"status": "stubbed"}

    # --- UI-directive tools (no args; status routes through _STUBS) ----
    async def connect_workspace() -> dict[str, Any]:
        """Surface the workspace-connect UI prompt. Eval stub."""
        return {"status": "stubbed"}

    async def auth_user(mode: str, email: str | None = None) -> dict[str, Any]:
        """Surface the sign-in UI prompt. Eval stub."""
        return {"status": "stubbed"}

    async def upgrade_to_pro() -> dict[str, Any]:
        """Surface the upgrade-to-Pro UI prompt. Eval stub."""
        return {"status": "stubbed"}

    tools: list[Any] = [
        FunctionTool(call_workspace),
        FunctionTool(update_user_profile),
        FunctionTool(log_goal_update),
        FunctionTool(memory_save),
        FunctionTool(connect_workspace),
        FunctionTool(auth_user),
        FunctionTool(upgrade_to_pro),
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
