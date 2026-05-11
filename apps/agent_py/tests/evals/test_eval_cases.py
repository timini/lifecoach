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

# Fixtures whose `eval_set_id` starts with `subagent_triage_` target the
# triage_inbox sub-agent directly (its own LlmAgent + stubbed list_inbox /
# get_message). Anything else runs against the main coach agent stub.
_AGENT_MODULES: dict[str, str] = {
    "subagent_triage_": "tests.evals.eval_triage_inbox_agent",
}
_DEFAULT_AGENT_MODULE = "tests.evals.eval_agent"


def _agent_module_for(fixture: str) -> str:
    for prefix, mod in _AGENT_MODULES.items():
        if fixture.startswith(prefix):
            return mod
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

    modules = {_DEFAULT_AGENT_MODULE, *_AGENT_MODULES.values()}
    for mod_name in modules:
        mod = importlib.import_module(mod_name)
        assert hasattr(mod, "root_agent"), f"{mod_name} missing root_agent"


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
