"""Tier-1 eval agent for `google_linked` user state.

User is signed in with Google but has NOT granted Workspace scopes.
Tool list per `state/policies.py`: `connect_workspace` is available
(it's the OAuth-scope-grant flow), but the nine workspace tools are
NOT — they only exist for `workspace_connected`. This is the state
the WORKSPACE-ASK TRIGGER routes to `connect_workspace` on workspace
asks.
"""

from __future__ import annotations

from google.adk.agents import Agent

from tests.evals.eval_agent import build_eval_root_agent

root_agent: Agent = build_eval_root_agent("google_linked")
