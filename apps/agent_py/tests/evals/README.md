# Lifecoach evals

End-to-end behavioural tests for the agent, using
`google.adk.evaluation.AgentEvaluator`. Two tiers:

## Tier 1 — deterministic, stubbed (default)

Runs against a stub agent module (`tests.evals.eval_agent`) that
short-circuits every external dependency:

- `before_tool_callback` returns canned responses for every tool the
  case exercises.
- HTTP-based context fetchers (weather, places, holidays, etc.) are
  patched at module load.
- `MemoryClient` is the noop client.

The model (Gemini) **is still called** by ADK's runner — Tier 1 is
"all I/O stubbed", not "model stubbed". This means:
- Tier 1 needs **`GOOGLE_GENAI_USE_VERTEXAI=1`** + a Vertex-enabled
  project to run, BUT
- Cost is bounded: each case is a handful of model turns, no parallel
  API calls.
- Run via `just eval`. Skipped by default in `just test-py` because
  not every dev has Vertex creds plumbed locally.

## Tier 2 — real LLM, real Memory Bank, manual / nightly

Same eval-set JSON, but no stubs at all. Real Gemini, real Vertex
Memory Bank, real Google Workspace API calls (against a dedicated
test workspace). Gated behind `LIFECOACH_EVAL_REAL_LLM=1`.

Run via `just eval-real`. Costs $$ per run; intended for nightly CI
and pre-cutover smoke runs.

## Eval cases

Flagship in `fixtures/morning_triage_full_flow.evalset.json` —
mirrors the PR #54 regression class. The remaining 5 cases from the
plan are filed as follow-up issues; the harness is sufficient to add
them without further redesign:

- `morning_triage_full_flow` ← shipped
- `find_workspace_specific_lookup` (follow-up)
- `find_workspace_calendar_list` (workspace sub-agent calendar-ID routing)
- `add_calendar_event_after_confirm` (follow-up)
- `complete_task_uses_patch` (follow-up)
- `workspace_disconnected_decline` (follow-up)

## Adding a new case

1. Drop a new `<case>.evalset.json` under `fixtures/`.
2. Extend `tests/evals/eval_agent.py` with stubs for any new tools the
   case exercises (`before_tool_callback`).
3. Add a parametrize entry in `tests/evals/test_eval_cases.py`.
4. Run `just eval` locally to verify.
