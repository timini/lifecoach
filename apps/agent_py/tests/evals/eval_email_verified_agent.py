"""Tier-1 eval agent for `email_verified` user state.

Pairs with `eval_anonymous_agent.py` to cover the second pre-Google
state for the WORKSPACE-ASK TRIGGER (issue #62) fixtures. The tool
list is identical to anonymous (auth_user only — no workspace tools,
no connect_workspace yet) but the state directive differs.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent("email_verified")
