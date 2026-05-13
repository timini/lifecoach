"""Tier-1 eval agent for a `tier=pro` user at any turn count → `pro`
UsageState (no nudges, no credit-count block, full model).

Used by the negative-case fixture asserting Pro users never get
hit with signup or pro pitches even at heavy chat counts.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent(
    "google_linked",
    usage_state="pro",
    chat_turn_count=7,
)
