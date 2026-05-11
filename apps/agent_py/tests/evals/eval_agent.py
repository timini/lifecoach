"""Stub agent module(s) used by Tier-1 evals.

ADK's `AgentEvaluator` imports a `root_agent` from the module named in
`agent_module=`. The agent is built ONCE at import time — its
instruction string and tool list are fixed for every case in every
fixture that routes to that module. **Session state on the fixture
(`_lifecoach_user_state`) does NOT rebuild the agent**: it only seeds
runtime session state, which is too late to change the system prompt
or which tools the model can see.

Codex P2 on PR #63 caught this: my new TRIGGER fixtures set
`_lifecoach_user_state: "google_linked"` etc., but the eval was
running under the original `workspace_connected` agent with the full
tool surface — covering the regression for the wrong reason or not at
all.

The fix is one agent module per UserState we want to test. Each
module exports a `root_agent` built with the right state's prompt +
tool list (mirroring what the production runner registers in
`main.py`). Fixtures declare `agent_module` at the top level; the
test dispatcher reads that and routes accordingly.

`tests.evals.eval_agent` (this file) keeps exporting `root_agent` for
`workspace_connected` — the default — so existing fixtures and the
no-`agent_module` fallback in `test_eval_cases.py` continue to work.

Per-state companion modules live alongside this one:

  - `eval_anonymous_agent.py`         — anonymous user (auth_user only)
  - `eval_email_verified_agent.py`    — email_verified (auth_user only)
  - `eval_google_linked_agent.py`     — google_linked (connect_workspace only)
  - `eval_triage_inbox_agent.py`      — workspace sub-agent (separate)

The tool factory below is parametrised; the per-state modules import
`build_eval_root_agent(state)` from here and re-export.
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
from lifecoach_agent.state import UserState
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
        # ---- workspace AgentTools (read flows) ----
        "triage_inbox": {
            "status": "ok",
            "report": {
                "noise": [{"id": "m1", "from": "n@x", "subject": "Newsletter"}],
                "actions": [],
                "events": [],
                "info": [],
            },
        },
        "find_workspace": {
            "status": "ok",
            "answer": "Nothing notable matched.",
        },
        # ---- workspace narrow writes ----
        "archive_messages": {"status": "ok", "archived": ["m1"], "failed": []},
        "add_calendar_event": {
            "status": "ok",
            "event": {"id": "ev1", "summary": "(stub)", "start": {}, "end": {}},
        },
        "add_task": {
            "status": "ok",
            "task": {
                "id": "t1",
                "taskListId": "@default",
                "title": "(stub)",
                "status": "needsAction",
            },
        },
        "complete_task": {
            "status": "ok",
            "task": {
                "id": "t1",
                "taskListId": "@default",
                "title": "(stub)",
                "status": "completed",
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


def _build_instruction_ctx(now: datetime, *, user_state: UserState) -> InstructionContext:
    return InstructionContext(
        now=now,
        timezone="Europe/London",
        user_state=user_state,
        memory_enabled=False,
    )


def _make_stub_tools_for_state(state: UserState) -> list[Any]:
    """Return the tool list the production runner would register for
    `state`. Mirrors `main.py`'s per-state branches so the model sees
    the same surface area in eval as in prod. Tools the state doesn't
    expose are simply absent — same as production.

    Mapping (matches `main.py:404-422` + `state/policies.py`):
      - Always: update_user_profile, log_goal_update,
        ask_single_choice_question, ask_multiple_choice_question.
      - anonymous / email_pending / email_verified: + auth_user
      - google_linked / workspace_connected: + connect_workspace
        (reconnect path stays available)
      - workspace_connected: + the six workspace tools
    """
    from google.adk.tools import FunctionTool

    # --- core: always present ---------------------------------------
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

    async def upgrade_to_pro() -> dict[str, Any]:
        """Surface the upgrade-to-Pro UI prompt. Eval stub."""
        return {"status": "stubbed"}

    tools: list[Any] = [
        FunctionTool(update_user_profile),
        FunctionTool(log_goal_update),
        FunctionTool(memory_save),
        FunctionTool(upgrade_to_pro),
        create_ask_single_choice_tool(),
        create_ask_multiple_choice_tool(),
    ]

    # --- pre-Google-signin states get auth_user --------------------
    if state in ("anonymous", "email_pending", "email_verified"):

        async def auth_user(mode: str, email: str | None = None) -> dict[str, Any]:
            """Surface the sign-in UI prompt. Eval stub."""
            return {"status": "stubbed"}

        tools.append(FunctionTool(auth_user))

    # --- google_linked + workspace_connected get connect_workspace -
    if state in ("google_linked", "workspace_connected"):

        async def connect_workspace() -> dict[str, Any]:
            """Surface the workspace-connect UI prompt. Eval stub."""
            return {"status": "stubbed"}

        tools.append(FunctionTool(connect_workspace))

    # --- workspace_connected gets the six workspace tools ----------
    if state == "workspace_connected":

        async def triage_inbox(since: str | None = None) -> dict[str, Any]:
            """Inbox triage AgentTool — eval stub."""
            return {"status": "stubbed"}

        async def find_workspace(query: str) -> dict[str, Any]:
            """Workspace search AgentTool — eval stub."""
            return {"status": "stubbed"}

        async def archive_messages(ids: list[str]) -> dict[str, Any]:
            """Batched archive — eval stub."""
            return {"status": "stubbed"}

        async def add_calendar_event(
            summary: str,
            start: str,
            end: str | None = None,
            location: str | None = None,
            description: str | None = None,
            calendarId: str = "primary",  # noqa: N803
        ) -> dict[str, Any]:
            """Calendar insert — eval stub."""
            return {"status": "stubbed"}

        async def add_task(
            title: str,
            due: str | None = None,
            notes: str | None = None,
            taskListId: str = "@default",  # noqa: N803
        ) -> dict[str, Any]:
            """Tasks insert — eval stub."""
            return {"status": "stubbed"}

        async def complete_task(
            id: str, taskListId: str = "@default"  # noqa: N803
        ) -> dict[str, Any]:
            """Tasks patch — eval stub."""
            return {"status": "stubbed"}

        tools.extend(
            [
                FunctionTool(triage_inbox),
                FunctionTool(find_workspace),
                FunctionTool(archive_messages),
                FunctionTool(add_calendar_event),
                FunctionTool(add_task),
                FunctionTool(complete_task),
            ]
        )

    return tools


def build_eval_root_agent(state: UserState) -> Agent:
    """Build a stub agent for one specific UserState. The agent's
    system instruction is materialised for that state (so the
    WORKSPACE-ASK TRIGGER routing matches what production would do)
    and the tool list mirrors `main.py`'s per-state registration.

    `before_tool_callback` short-circuits real side effects with
    canned responses keyed by tool name. The model still emits the
    same call shape so trajectory evaluators see what they need."""
    now = datetime(2026, 5, 12, 9, 0, tzinfo=ZoneInfo("Europe/London"))
    ctx = _build_instruction_ctx(now, user_state=state)
    tools = _make_stub_tools_for_state(state)
    agent = build_root_agent_for(ctx, tools)
    agent.before_tool_callback = _stub_before_tool
    return agent


# Default `root_agent` for fixtures that don't specify `agent_module`.
# The original eval surface was workspace_connected with the full tool
# list — preserved here so existing fixtures keep working unchanged.
root_agent: Agent = build_eval_root_agent("workspace_connected")


# Suppress unused import warnings for `noop_memory_client` /
# `CallbackContext` — they're imported here so future cases that need
# them don't have to chase the right import path.
_ = noop_memory_client, CallbackContext
