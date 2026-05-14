# tranquil.coach

A warm, conversational calm AI coach. Chats like a friend texting, not a robot writing an email. Remembers you across sessions, knows what's on your calendar, can read your inbox and your task list, and never asks twice for things you've already told it.

The repo is a polyglot monorepo with two deployables:

- **apps/web** — Next.js 15 (App Router, React 19) on Cloud Run, behind Firebase Auth
- **apps/agent_py** — A [Google ADK](https://github.com/google/adk-python) Python agent running Gemini 3 Flash on Vertex AI, served from Cloud Run as a FastAPI HTTP/SSE service. (Replaced the original TS port at PR #56's cutover — see `apps/agent_py/_PORTING.md` for the migration story.)

Shared code lives in `packages/*`. Infrastructure is Terraform in `infra/`. CI gates the whole thing on **90% line + branch coverage**.

---

## Features

### For the user

- **No friction first run** — anonymous Firebase sign-in, talk to the coach immediately. Upgrade to Google or email later; nothing is lost.
- **Warm, short, non-corporate replies** — the system prompt explicitly forbids "as an AI…" openings, bullet lists, and three-paragraph affirmations.
- **Knows the local context** — current time in *your* timezone, your weather, nearby places, recent goal progress — all injected into the prompt every turn so the agent doesn't have to ask.
- **Browser-only geolocation.** Location comes from `navigator.geolocation`. If you deny permission, location is `null` and the coach operates without weather/places. **No IP-based geolocation, ever** — there's a CI guard that fails the build if anyone adds `geoip-lite`, `cf-connecting-ip`, etc.
- **Real Google Workspace integration** — once connected, the agent can read your Gmail, manage your Calendar, and triage your Tasks via natural language. OAuth tokens never touch the LLM.
- **Long-term memory** via [mem0](https://mem0.ai) — important facts (kids' names, fitness goals, what you don't like) survive across sessions.
- **Markdown rendering** in assistant bubbles (lists, bold, inline code).
- **Cost-tier nudges** — anonymous heavy users get a gentle "create an account?" suggestion; signed-in heavy users get an organic "want to try Pro?" pitch. The LLM never sees billing state — tier decisions happen server-side.

### For the developer

- **Strict architectural invariants** (see `CLAUDE.md`):
  - The agent has **no read tools** for routine context. Time, weather, profile, goal updates — all *injected into the system prompt* by `buildInstruction()`. Reading via tool wastes LLM turns.
  - Only **writes** and **UI directives** are tools.
  - `UserStateMachine` is the single source of truth for which tools/affordances are available — no ad-hoc `user.isAnonymous` branching.
  - `packages/shared-types` Zod schemas are the contract between web and agent.
  - All infra is Terraform. No `gcloud services enable`, no console clicks.
- **Red-Green-Refactor TDD** — every change ships with a failing test first.
- **One logical change per PR**, hooks enforce Biome + typecheck + the no-IP grep guard.

---

## Architecture

**See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full spec** — system topology, end-to-end chat-turn sequence, state machines, wire contracts, infra, testing strategy, and the documentation-maintenance protocol.

A short orientation:

- The browser (Next.js / React 19) holds the Firebase ID token and `navigator.geolocation` lat/lng.
- `apps/web` API routes are thin proxies that attach the bearer header and forward to the agent. `/api/chat` runs on the **edge runtime** so SSE bytes flush through unmodified.
- `apps/agent_py` (Python ADK 1.32 + FastAPI on Cloud Run) handles the conversation: it verifies the bearer, fetches per-uid context (weather, places, profile, goals, memories) **in parallel**, materialises the system prompt, and streams Gemini's events back as SSE.
- The agent has **no read tools** for routine context — everything is injected by `build_instruction()` every turn. Only writes and UI directives are tools.
- Long-term facts live in **Vertex Memory Bank**. Session transcripts live in Firestore. User profile + goals + audit log live in a per-uid GCS bucket.
- `UserStateMachine` (auth identity) and `UsageStateMachine` (cost tier) compose at the runner-build call site. The LLM never sees auth or billing state — it sees the *consequence* (which tools, which model, which directive).

### Repo layout

```
.
├── apps/
│   ├── agent_py/                 FastAPI + Python ADK, Cloud Run
│   │   ├── src/lifecoach_agent/
│   │   │   ├── server.py         /chat (SSE), /history, /profile, /goals, /workspace/*
│   │   │   ├── agent.py          build_root_agent_for(ctx, tools, model)
│   │   │   ├── auth.py           verify_id_token (firebase-admin)
│   │   │   ├── prompt/
│   │   │   │   └── build_instruction.py  system-prompt assembly
│   │   │   ├── context/          weather, places, holidays, air_quality,
│   │   │   │                     calendar_density, session_summary,
│   │   │   │                     memory (Vertex Memory Bank)
│   │   │   ├── storage/          user_profile, profile_history,
│   │   │   │                     goal_updates (GCS), user_meta,
│   │   │   │                     workspace_tokens, firestore_session
│   │   │   ├── tools/            ask_choice, auth_user, connect_workspace,
│   │   │   │                     log_goal_update, memory_save,
│   │   │   │                     update_user_profile, upgrade_to_pro
│   │   │   ├── workspace_agent/  call_workspace dispatcher (drops gws CLI;
│   │   │   │                     uses google-api-python-client directly)
│   │   │   └── oauth/            workspace_client.py (httpx, no
│   │   │                         google-auth-library)
│   │   ├── tests/evals/          ADK eval harness + 6 flagship cases
│   │   └── Dockerfile
│   └── web/                      Next.js 15 App Router, React 19
│       ├── src/
│       │   ├── app/
│       │   │   └── api/          /chat, /chat/history, /profile, /goals,
│       │   │                     /workspace/{oauth-exchange,status,*}
│       │   ├── components/       ChatWindow, AccountMenu, ...
│       │   └── lib/              firebase, geolocation, sse, eventHistory,
│       │                         workspace
│       └── Dockerfile
├── packages/
│   ├── user-state/               UserStateMachine + UsageStateMachine
│   ├── shared-types/             Zod schemas (web↔agent contract)
│   ├── ui/                       React components (Tailwind 4)
│   ├── testing/                  Fakes + test utilities
│   └── config/                   Shared metadata
├── infra/
│   ├── bootstrap/                One-time per env (project + state bucket)
│   ├── envs/{dev,prod}/          terraform.tfvars + backend.hcl
│   ├── modules/                  apis, artifact_registry, firebase_auth,
│   │                             cloud_run, firestore, storage,
│   │                             gws_oauth_secret
│   └── deploy.sh                 Build Docker, push to AR, terraform apply
├── Justfile
├── biome.json
├── turbo.json
└── pnpm-workspace.yaml
```

---

## Running locally

Prereqs: Node ≥ 22, pnpm ≥ 9.12.3 (pinned), `uv` (for the Python agent), `just`, Docker (for deploys), `gcloud`, `terraform`.

```bash
just install        # pnpm install + uv sync (apps/agent_py)
just dev            # web (Next on :3000) — turbo runs dev across packages
just dev-web        # just web
just dev-py         # Python agent (uvicorn) on :8080
just test           # vitest across all TS packages
just test-py        # pytest in apps/agent_py
just lint-py        # ruff check + format-check
just typecheck-py   # mypy on apps/agent_py/src
just eval           # Tier-0 eval-set fixture-shape smoke (free, deterministic)
just eval-real      # Tier-1 evals against real Gemini (gated by LIFECOACH_EVAL_REAL_LLM=1)
just coverage       # 90% gate; CI fails below
just e2e            # Playwright (against the deployed preview URL)
just deploy dev     # build + push + terraform apply
just logs-agent dev # gcloud logging tail for the agent service
```

`.env.local` (gitignored) holds local secrets. Production uses GCP Secret Manager via Terraform.

For full layout — every endpoint, tool, context provider, storage doc, infra module, and CI workflow — see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Workflow

Red-Green-Refactor TDD on every change:

1. **Red** — write a failing test that names the behavior. Run, confirm it fails *for the expected reason*.
2. **Green** — minimum code to pass. No adjacent features, no premature generalization.
3. **Refactor** — rename/extract/dedupe with tests green. Re-run after each step.

90% line + branch coverage across the monorepo. CI fails below. No `/* istanbul ignore */`.

Pre-commit hooks (Biome, typecheck, test, no-IP grep guard) must pass — never `--no-verify`.

---

## Non-negotiable invariants

CI fails on each one — full rationale and enforcement detail in [`ARCHITECTURE.md` §13](./ARCHITECTURE.md#13-non-negotiable-invariants).

1. **No IP-based geolocation — ever.** `navigator.geolocation` only.
2. **The agent has no read tools for routine context** — everything injected by `build_instruction()`.
3. **`UserStateMachine` is the single source of truth** for tools + affordances.
4. **`packages/shared-types` is the contract** for all data crossing web↔agent.
5. **All infra is Terraform** — no console clicks, no `gcloud services enable`.
6. **The LLM never sees auth or billing state.** UI-directive tools only.
7. **The SSE wire format is camelCase** — agent name is `"lifecoach"`, events serialise with Pydantic aliases.

See [`CLAUDE.md`](./CLAUDE.md) for the assistant-facing guide and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the spec.
