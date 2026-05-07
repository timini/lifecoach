# `apps/agent_py` — Lifecoach agent (Python ADK)

Python port of `apps/agent/`. Replaces the TS Express + `@google/adk@0.6.1`
service with a FastAPI + `google-adk` 1.32 service. Same `/chat` SSE wire
format, same Firestore schemas, same Cloud Run service. The why:

- **Evals** — Python ADK ships a complete eval framework (`adk eval` CLI +
  `AgentEvaluator.evaluate()` for pytest). The TS port says "Coming soon".
- **Vertex Memory Bank** — first-class in Python (`VertexAiMemoryBankService`).
  TS port doesn't have it; we worked around with mem0 and now drop both.
- **No `gws` CLI subprocess** — `google-api-python-client` directly. Drops
  ~500 lines of subprocess plumbing + base64 decode hacks.
- **Sub-agent event streaming** — Python ADK runner yields inner events
  natively, closing the nested-tool-call-badges story (#55) for free.

See `~/.claude/plans/no-server-ip-fallback-encapsulated-sunset.md` for the
full plan and phasing.

## Local dev

```sh
just install                # uv sync — installs deps from uv.lock
just dev-py                 # uvicorn lifecoach_agent.server:app --reload
just test-py                # pytest
just lint-py                # ruff check + ruff format --check
just typecheck-py           # mypy
just eval                   # pytest tests/evals/ (Tier 1, fully stubbed)
just eval-real              # tests/evals/ with LIFECOACH_EVAL_REAL_LLM=1
```

## Layout

See `_PORTING.md` for module-by-module TS→Py port status.

```
src/lifecoach_agent/
  agent.py              # root Agent factory
  server.py             # FastAPI app
  contracts/            # Pydantic models — generated from packages/shared-types
  chat/                 # empty-turn guard, recovery flow
  prompt/               # buildInstruction equivalents
  practices/            # practice directives (day_planning, evening_gratitude, journaling)
  state/                # UserState/UsageState/DailyFlow machines
  context/              # weather, places, holidays, calendar density, memory, summaries
  tools/                # main-agent tools
  workspace_agent/      # workspace sub-agent + 9 internal tools + 2 AgentTool wrappers
  storage/              # Firestore session, profile, history, goal updates, etc.
  oauth/                # workspace OAuth client
  auth.py               # Firebase ID token verification
  sentry_setup.py
tests/
  unit/                 # pytest mirror of the TS unit tests
  evals/                # ADK eval cases (Python ADK eval-set JSON format)
```

## Status

This package is bootstrapping. **Not in production**. The TS service in
`apps/agent/` remains the live agent until Phase 12 cutover.
