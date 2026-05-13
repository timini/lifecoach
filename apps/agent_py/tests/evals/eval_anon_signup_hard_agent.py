"""Tier-1 eval agent for `anonymous` user at `free_signup_hard`
(chatTurnCount=12 — mid-hard-nudge window 10–14).

Pins the SIGNUP_HARD directive + USAGE credit-count block ("free turn
12 of 25"). Used by fixtures asserting the agent fires
`auth_user({mode:"google"})` on persistence-adjacent asks AND surfaces
the credit count truthfully.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent(
    "anonymous",
    usage_state="free_signup_hard",
    chat_turn_count=12,
)
