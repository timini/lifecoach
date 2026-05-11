"""Tier-1 eval agent for `anonymous` user state.

Built specifically so the WORKSPACE-ASK TRIGGER (issue #62) eval
fixtures targeting `anonymous` users actually run against the right
system instruction + tool list. `tests.evals.eval_agent.root_agent` is
the `workspace_connected` default; this module is its anon sibling.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent("anonymous")
