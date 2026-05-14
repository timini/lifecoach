"""Per-turn agent factory.

Mirrors `apps/agent/src/agent.ts` (`createRootAgent`). Each /chat turn
calls `build_root_agent_for(ctx, tools, model)` to mint a fresh
`Agent` whose system instruction is the materialised prompt for THIS
turn (via `prompt.build_instruction`) and whose tool list is whatever
the server decided to register based on `userState`, usage policy,
memory + workspace presence, and enabled practices.

The previous Phase 0 placeholder (`build_root_agent()` with no args
returning a hello-world Agent) is preserved at module level so
`adk web` and the smoke tests keep working without server wiring.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any, Protocol

from google.adk.agents import Agent

from lifecoach_agent.prompt.build_instruction import (
    InstructionContext,
    build_instruction,
)

if TYPE_CHECKING:
    from google.genai import types as genai_types

DEFAULT_MODEL = os.environ.get("LIFECOACH_MODEL", "gemini-3-flash-preview")


def build_root_agent_for(
    ctx: InstructionContext,
    tools: list[Any],
    *,
    model: str = DEFAULT_MODEL,
) -> Agent:
    """Build a fresh `Agent` for one /chat turn.

    `ctx` is fed straight into `build_instruction` — the resulting
    string becomes the system instruction. `tools` is whatever the
    server decided to register for this state + policy. `model` is
    selected by `UsageStateMachine.policy().model` so heavy anonymous
    users get the cheaper Flash Lite variant.
    """
    instruction = build_instruction(ctx)
    return Agent(
        name="lifecoach",
        model=model,
        description="tranquil.coach — daily-practice coaching agent.",
        instruction=instruction,
        tools=tools,
    )


def build_root_agent() -> Agent:
    """Hello-world agent for `adk web` / smoke tests. Real /chat traffic
    goes through `build_root_agent_for`, which materialises the full
    instruction + tool list per turn."""
    return Agent(
        name="lifecoach",
        model=DEFAULT_MODEL,
        description="tranquil.coach — daily-practice coaching agent.",
        instruction=(
            "You are tranquil.coach, an empathetic daily-practice coach. "
            "This is the standalone agent entry point used by `adk web` and "
            "smoke tests; the full per-turn prompt + tool surface comes "
            "from the FastAPI server in `lifecoach_agent.server`."
        ),
    )


root_agent: Agent = build_root_agent()


# --- Runner Protocol ------------------------------------------------------
#
# Lets tests pass a fake runner without pulling in the real LLM / session
# machinery. Mirrors the TS `RunnerLike` shape from `server.ts`.


class _SessionServiceLike(Protocol):
    async def create_session(
        self, *, app_name: str, user_id: str, session_id: str | None = ...
    ) -> Any: ...

    async def get_session(self, *, app_name: str, user_id: str, session_id: str) -> Any: ...

    # Optional in the TS surface; tests can omit.
    async def append_event(self, *, session: Any, event: Any) -> Any: ...


class RunnerLike(Protocol):
    """Minimal Runner surface the server depends on."""

    app_name: str
    session_service: _SessionServiceLike

    def run_async(
        self,
        *,
        user_id: str,
        session_id: str,
        new_message: genai_types.Content | None = ...,
        run_config: Any | None = ...,
    ) -> Any:  # AsyncIterator[Event]
        ...
