"""Eval cases driven by ADK's `AgentEvaluator`.

These tests hit the real Gemini API (Tier 1) — the eval framework
itself runs the agent end-to-end; only I/O-bound tools are stubbed
via `before_tool_callback` in `eval_agent.py`. Skipped by default
because not every dev has Vertex creds plumbed locally; opt in via
`LIFECOACH_EVAL_REAL_LLM=1` or `just eval-real`.

A bare `just eval` runs the JSON-shape smoke test below — confirms
every fixture parses, has a stable `eval_set_id`, and points at the
agent module that exists. Useful CI guard rail; doesn't burn LLM tokens.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
# `Path.stem` only strips the final suffix — for `foo.evalset.json` it
# returns `foo.evalset`. Strip the `.evalset` ourselves so we get clean
# `eval_set_id` keys back.
ALL_FIXTURES: list[str] = sorted(
    p.name.removesuffix(".evalset.json") for p in FIXTURES.glob("*.evalset.json")
)

# Default agent module when a fixture doesn't declare `agent_module`.
# Codex P2 on PR #63 caught a real bug here: `_lifecoach_user_state`
# on the fixture session-state does NOT rebuild the agent — ADK binds
# instruction + tool list at module import time, so per-case state
# overrides don't change the surface the model sees. Per-fixture
# `agent_module` (top-level JSON field) routes each fixture to a
# state-specific module that materialised the right prompt + tools.
#
# Known per-state modules. UserState-only modules are the older surface
# (pre-issue-#64); the `eval_*_agent` modules suffixed with a usage state
# (e.g. `eval_anon_signup_hard_agent`) pin a specific funnel position
# (UserState × UsageState × chatTurnCount) for the issue-#64 fixtures.
#
#   - tests.evals.eval_agent                       workspace_connected (default)
#   - tests.evals.eval_anonymous_agent             anonymous, fresh
#   - tests.evals.eval_email_verified_agent        email_verified
#   - tests.evals.eval_google_linked_agent         google_linked, fresh
#   - tests.evals.eval_triage_inbox_agent          workspace sub-agent
#   - tests.evals.eval_anon_signup_soft_agent      anonymous @ turn 7
#   - tests.evals.eval_anon_signup_hard_agent      anonymous @ turn 12
#   - tests.evals.eval_anon_throttled_agent        anonymous @ turn 18 (flash-lite)
#   - tests.evals.eval_signed_in_pro_soft_agent    google_linked @ turn 25
#   - tests.evals.eval_signed_in_pro_hard_agent    google_linked @ turn 75
#   - tests.evals.eval_pro_tier_agent              tier=pro, any turn
_DEFAULT_AGENT_MODULE = "tests.evals.eval_agent"

# Used by the import-sanity test below. Keep in sync with the
# `agent_module` values fixtures declare.
_KNOWN_AGENT_MODULES: set[str] = {
    _DEFAULT_AGENT_MODULE,
    "tests.evals.eval_anonymous_agent",
    "tests.evals.eval_email_verified_agent",
    "tests.evals.eval_google_linked_agent",
    "tests.evals.eval_triage_inbox_agent",
    "tests.evals.eval_anon_signup_soft_agent",
    "tests.evals.eval_anon_signup_hard_agent",
    "tests.evals.eval_anon_throttled_agent",
    "tests.evals.eval_signed_in_pro_soft_agent",
    "tests.evals.eval_signed_in_pro_hard_agent",
    "tests.evals.eval_pro_tier_agent",
}


def _agent_module_for(fixture: str) -> str:
    """Read the `agent_module` field from the fixture JSON, falling
    back to the workspace_connected default."""
    payload = json.loads((FIXTURES / f"{fixture}.evalset.json").read_text())
    declared = payload.get("agent_module")
    if isinstance(declared, str) and declared:
        return declared
    return _DEFAULT_AGENT_MODULE


# --- Tier-0 fixture-shape smoke tests (free, deterministic) ---------------


@pytest.mark.parametrize("fixture", ALL_FIXTURES)
def test_eval_fixture_parses(fixture: str) -> None:
    """Every fixture must be valid JSON with the ADK eval-set shape."""
    payload = json.loads((FIXTURES / f"{fixture}.evalset.json").read_text())
    assert payload["eval_set_id"] == fixture
    assert isinstance(payload.get("eval_cases"), list)
    assert payload["eval_cases"], f"{fixture} has no cases"
    for case in payload["eval_cases"]:
        assert isinstance(case.get("eval_id"), str)
        assert isinstance(case.get("conversation"), list)


def test_eval_agent_module_imports() -> None:
    """Sanity: every eval agent module the harness can target must
    import cleanly (no broken `before_tool_callback`, no missing tool
    factories)."""
    import importlib

    for mod_name in _KNOWN_AGENT_MODULES:
        mod = importlib.import_module(mod_name)
        assert hasattr(mod, "root_agent"), f"{mod_name} missing root_agent"


def test_fixture_agent_module_in_known_set() -> None:
    """Every fixture's declared `agent_module` (or the default fallback)
    must point at one of the known per-state modules. Catches typos
    that would otherwise surface as ImportError at Tier-1 runtime."""
    for fixture in ALL_FIXTURES:
        module = _agent_module_for(fixture)
        assert module in _KNOWN_AGENT_MODULES, (
            f"{fixture} declares unknown agent_module={module!r}. "
            f"Known: {sorted(_KNOWN_AGENT_MODULES)}"
        )


# --- Tier-1 real-LLM eval cases (gated) -----------------------------------


@pytest.mark.real_llm
@pytest.mark.skipif(
    os.environ.get("LIFECOACH_EVAL_REAL_LLM") != "1",
    reason="Tier-1 evals hit real Gemini; opt in with LIFECOACH_EVAL_REAL_LLM=1",
)
@pytest.mark.parametrize("fixture", ALL_FIXTURES)
@pytest.mark.asyncio
async def test_eval_case_against_real_llm(fixture: str) -> None:
    """Run each eval-set fixture through ADK's `AgentEvaluator`.
    Compares the actual model trajectory to the expected one in the
    JSON fixture; failure means the agent didn't call the right tool
    in the right order (or went silent post-tool — the PR #54 class)."""
    from google.adk.evaluation.agent_evaluator import AgentEvaluator

    await AgentEvaluator.evaluate(
        agent_module=_agent_module_for(fixture),
        eval_dataset_file_path_or_dir=str(FIXTURES / f"{fixture}.evalset.json"),
    )
