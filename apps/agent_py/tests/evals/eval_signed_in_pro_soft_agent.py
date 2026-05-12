"""Tier-1 eval agent for signed-in (`google_linked`) free-tier user at
`pro_pitch_soft` (chatTurnCount=25 — mid-soft-pro window 20–49).

Pins the PRO_SOFT directive + `upgrade_to_pro` tool availability so
fixtures can assert the agent surfaces a Pro offer once, naturally,
without pitching every turn.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent(
    "google_linked",
    usage_state="pro_pitch_soft",
    chat_turn_count=25,
)
