"""Tier-1 eval agent for signed-in (`google_linked`) free-tier user at
`pro_pitch_hard` (chatTurnCount=75 — mid-hard-pro window 50–99, on
flash-lite).

Pins PRO_HARD + USAGE credit-count ("chat number 75 of 100") + model
downgrade to flash-lite. Fixtures pointing here assert the trajectory
fires `upgrade_to_pro` on depth-adjacent asks.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent(
    "google_linked",
    usage_state="pro_pitch_hard",
    chat_turn_count=75,
)
