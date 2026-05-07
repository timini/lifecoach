"""Root agent factory.

Phase 0 placeholder: a hello-world `Agent` so `adk run` and `adk web` start
against this package. Real wiring (state-aware tools, prompt builder,
sub-agents) lands in Phases 2–9.
"""

from __future__ import annotations

import os

from google.adk.agents import Agent

DEFAULT_MODEL = os.environ.get("LIFECOACH_MODEL", "gemini-3-flash-preview")


def build_root_agent() -> Agent:
    return Agent(
        name="lifecoach_agent",
        model=DEFAULT_MODEL,
        description="Lifecoach — daily-practice coaching agent.",
        instruction=(
            "You are Lifecoach, an empathetic daily-practice coach. "
            "This is the Phase 0 bootstrap build — the full prompt and tool "
            "surface are wired in later phases. For now, greet the user and "
            "explain that the Python rebuild is in progress."
        ),
    )


root_agent: Agent = build_root_agent()
