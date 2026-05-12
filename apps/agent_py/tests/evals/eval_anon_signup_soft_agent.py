"""Tier-1 eval agent for `anonymous` user at `free_signup_soft`
(chatTurnCount=7 — mid-soft-nudge window 5–9).

Pins the directive injection so a fixture can assert the agent
surfaces a soft signup offer once, naturally, without nagging.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent(
    "anonymous",
    usage_state="free_signup_soft",
    chat_turn_count=7,
)
