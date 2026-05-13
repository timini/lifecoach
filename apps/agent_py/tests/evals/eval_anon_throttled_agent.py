"""Tier-1 eval agent for `anonymous` user at `free_throttled`
(chatTurnCount=18 — mid-throttled window 15–24).

Pins the model downgrade (flash-lite) + SIGNUP_HARD + THROTTLED_NOTICE
combo. Fixtures pointing here assert the trajectory still steers
toward signup and that the agent can honestly explain the lighter
model if the user notices.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent(
    "anonymous",
    usage_state="free_throttled",
    chat_turn_count=18,
)
