# tranquil.coach — AI Assistant Guide

This document is for AI coding assistants (Claude Code, etc.) working in this repository. Humans should also read it, but its primary audience is the model.

## What this project is

AI life coaching web app. Two deployables:
- `apps/web` — Next.js 15 on Firebase App Hosting
- `apps/agent_py` — Google ADK Python agent (Gemini 3 Flash, FastAPI + uvicorn) on Cloud Run. Replaced the TS service (`apps/agent/`) at PR #56's cutover; the Python rebuild ships first-class evals (`adk eval` / `AgentEvaluator`) and Vertex Memory Bank, and dropped the `gws` CLI subprocess in favour of `google-api-python-client`.

Plus one developer-only app:
- `apps/ui-book` — Storybook 9 host for the `@lifecoach/ui` design system. Stories are the test surface — every component under `packages/ui/src/{atoms,molecules,organisms,templates}/` has a sibling `*.stories.tsx` whose `play()` runs as a vitest test via `@storybook/addon-vitest` (Chromium browser mode). `scripts/check-stories.mjs` (lefthook + CI) enforces "every tier `.tsx` has a story".

Shared code lives in `packages/*`. Infrastructure is Terraform in `infra/`.

## Non-negotiable invariants

These are not opinions. Violating any of them fails CI.

### 1. No IP-based geolocation — ever

Location comes from `navigator.geolocation` in the browser **only**. If the user denies permission, location is `null` and the agent operates without location/weather/places context.

Forbidden in any file:
- Reading `x-forwarded-for`, `cf-connecting-ip`, or similar headers to infer location
- Dependencies: `geoip-lite`, `maxmind`, `@maxmind/geoip2-node`, `ipinfo`, `ip-api`, `ipapi`, `node-geoip`
- Reverse-resolving an IP to a city/country server-side

There is a `grep` guard in CI and lefthook that fails if these tokens appear. Do not add an allowlist comment to bypass it — fix the approach instead.

### 2. Agent has no read tools for routine context

Time, weather, user profile, nearby places, and recent goal updates are **injected into the system prompt every turn** by `buildInstruction()`. The agent must not have tools like `get_weather`, `get_profile`, `get_time`, `list_goals`. This is a deliberate choice — reading via tool wastes LLM turns.

Only **writes** and **UI directives** are tools:
`update_user_profile`, `log_goal_update`, `ask_single_choice_question`, `ask_multiple_choice_question`, `auth_user`, `run_gws` (when workspace-connected), plus ADK built-ins `google_search` and memory tools.

### 3. User state drives tools and prompt — single source of truth

The `UserStateMachine` in `packages/user-state` is the only place that decides:
- Which tools the agent can call
- Which state-specific directive is appended to the system prompt
- Which UI affordances render in the web app

Do not branch on `user.isAnonymous` or `user.providerData` ad-hoc in components or agent code. Always go through `UserStateMachine.policy()`.

### 4. Shared types are the contract

`packages/shared-types` is the source of truth for all data shapes crossing the web↔agent boundary. Both sides import the same Zod schemas. Do not re-declare a type locally that already lives there.

### 5. All infra is Terraform — no manual GCP changes

Every infrastructure change (new API enabled, new IAM binding, new Cloud Run service, new bucket, new Firebase config) goes in `infra/` as Terraform. The only exception is `infra/bootstrap/bootstrap.sh`, which runs once per environment to create the project and state bucket Terraform itself needs.

Forbidden:
- `gcloud services enable ...` to turn something on
- Clicking in the GCP / Firebase console to change configuration
- `terraform import` to retrofit manually-created resources (do it right: recreate via Terraform)

If you need something that isn't in `infra/` yet, add it as a module. See `infra/README.md` for the full flow.

## Workflow: Red-Green-Refactor TDD

Every change follows this loop:

1. **Red** — write a failing test that describes the behavior you want. Run it and confirm it fails for the expected reason (not an import error or typo).
2. **Green** — write the minimum code to make the test pass. Don't add adjacent features, don't refactor, don't generalize.
3. **Refactor** — with tests green, clean up: rename, extract, deduplicate. Run tests after each refactor step.

Guidance:
- New tool → write a unit test that calls the tool with mock inputs and asserts the expected GCS/UI/auth side effect.
- New state transition → write a test asserting `send(event)` returns the expected state and an illegal-transition test asserting it throws.
- New prompt directive → write a snapshot test against `buildInstruction()` with a fixed context.
- Bug fix → first reproduce the bug as a failing test, then fix.

## Coverage

90% lines and branches across the monorepo. CI fails below that. Do not add `/* istanbul ignore */` or `v8 ignore` to hide untested code — test it, or delete it.

## Branch and PR workflow

`main` is protected. Never commit directly to it.

Every change starts on a feature branch off main:
- `feat/<short-name>` — new features.
- `fix/<short-name>` — bug fixes.
- `chore/<short-name>` — tooling, refactors, doc tweaks.

Workflow: branch → commit → push → open PR → CI green → merge. Merging to main triggers `.github/workflows/deploy-dev.yml`, which builds the agent + web Docker images, pushes them to Artifact Registry, and runs `terraform apply` in `infra/envs/dev`.

Do not push directly to main. Do not bypass branch protection (`gh api -X PUT … enforce_admins=false` exists for true emergencies, not convenience). If a PR's CI is broken, fix it on the branch — don't merge yellow.

### Review apps (per-PR previews)

Opening a PR triggers `.github/workflows/pr-preview-deploy.yml`, which deploys a per-PR Cloud Run pair (`lifecoach-agent-pr-<n>`, `lifecoach-web-pr-<n>`) inside the dev project, runs Playwright against the deployed web URL, and comments the URLs + e2e result on the PR. Subsequent pushes to the same PR roll the preview to the new image (the previous run gets cancelled by the `preview-pr-<n>` concurrency group).

Closing the PR (merge or abandon) triggers `.github/workflows/pr-preview-teardown.yml`, which runs `terraform destroy` on the per-PR state slot. A daily sweeper (`preview-sweeper.yml`) catches anything the close hook missed.

Previews share dev's Firestore, mem0, GCS user bucket, Secret Manager secrets, and runtime SAs — all of those are owned by `infra/envs/dev`. The preview env (`infra/envs/preview/`) only owns the two per-PR Cloud Run services and one terraform state file under `gs://<dev-tfstate-bucket>/previews/<pr_number>/`. This keeps preview spin-up to a few minutes and idle cost ~$0.

Per invariant #5, `infra/envs/preview/` is Terraform-managed. Don't edit a per-PR Cloud Run service in the GCP console — push a new commit and let the workflow re-apply.

Local commands: `just deploy-preview <n>`, `just teardown-preview <n>`, `just e2e-preview <n>`.

## Commit and PR discipline

- One logical change per PR. A PR that touches the state machine should not also reformat unrelated files.
- Tests in the same commit as the code they test.
- PR title: imperative, under 70 chars. Body explains *why*, not *what* — the diff shows what.
- Pre-commit hooks (Biome, typecheck, test, no-IP guard) must pass before commit. Do not `--no-verify`.
- Squash-merge PRs by default — keeps main linear. Rebase if you want to preserve a meaningful series.

## Directory conventions

- `apps/web/src/lib/*` — client-safe utilities (can import from `packages/shared-types`, `packages/user-state`).
- `apps/web/src/app/api/*/route.ts` — server-only Next.js route handlers. Never import browser-only modules here.
- `apps/agent_py/src/lifecoach_agent/tools/*` — one tool per file. Bound to per-uid stores via factory (`create_*_tool({ store, uid })`). Wrapped as ADK `FunctionTool` from a clean async callable so eval / unit tests exercise the callable directly.
- `apps/agent_py/src/lifecoach_agent/context/*` — cached HTTP context providers (weather, places, holidays, air-quality, calendar density, session summary, Vertex Memory Bank). Cache keys + TTLs are documented at the top of each file.
- `apps/agent_py/src/lifecoach_agent/practices/*` — one Practice per file (Plan-the-day, Evening gratitude, Journaling). Each contributes a prompt directive when ON and zero or more tools.
- `apps/agent_py/src/lifecoach_agent/state/*` — UserState / UsageState / DailyFlow machines (port of `packages/user-state/`).
- `packages/*/src/index.ts` — each package has one barrel export.

## Running things

All routine tasks go through `just`:

```bash
just install         # pnpm install + uv sync (apps/agent_py)
just dev-web         # web only
just dev-py          # Python agent (uvicorn)
just test            # TS tests (web + packages)
just test-py         # Python agent tests
just lint-py         # ruff check + format-check
just typecheck-py    # mypy on apps/agent_py/src
just eval            # Tier-0 eval-set fixture-shape smoke (free, deterministic)
just eval-real       # Tier-1 evals against real Gemini (gated by LIFECOACH_EVAL_REAL_LLM=1)
just coverage        # enforce 90% gate (TS)
just lint            # biome --write (TS)
just typecheck       # tsc -b (TS — web + packages)
just e2e             # playwright (web e2e)
```

Don't invent new scripts in root `package.json` for one-off work — add a recipe to the Justfile if it's routine, otherwise just type the command.

## Secrets

Never commit secrets. Local dev uses `.env.local` (gitignored). Production uses GCP Secret Manager, wired through Terraform. If a test needs a credential, it uses a fake in `packages/testing`.

## Documentation maintenance

`ARCHITECTURE.md` is the system spec — system topology, the chat-turn sequence, state machines, every HTTP endpoint, every tool, every storage doc shape, the SSE wire contract, infra layout, testing strategy, and the invariants. **Keep it in sync as the code changes.**

The mechanical rule: **if a PR changes any of the following, the same PR updates `ARCHITECTURE.md`.** No drive-by updates in a separate "docs" PR — they fall behind.

Change-triggers (mirrored in `ARCHITECTURE.md` §14 so future work can be checked against it):

- A new HTTP endpoint, or a change to an existing one's auth / body / response → §7.1 + §10
- A new tool, or a change to a tool's args / side effect → §7.4
- A new context provider, or a change to a cache key / TTL / source → §7.5
- A new Firestore collection, GCS path, or document field crossing web↔agent → §7.6 + §10.2 / §10.3
- A new state in any state machine, a new transition, or a policy change → §4
- A new practice → §7.8
- A change to the system-prompt section list or order → §7.3
- A change to the SSE wire format (event shape, header, padding, terminator) → §10.1
- A new Cloud Run service, a new Terraform module, or a change to per-PR preview behaviour → §11
- A new test surface, a new eval fixture, or a change to the coverage gate → §12
- Anything that adds or modifies an invariant → §13

When in doubt, read `ARCHITECTURE.md` first to ground yourself in the current shape, *then* write code; if the change you're making invalidates a section, draft the doc update before you finish the implementation. Treat a stale `ARCHITECTURE.md` as a real bug — file an issue or fix it inline.

Don't proactively rewrite `ARCHITECTURE.md` unless the user asks or you are making changes the rule above demands. Drive-by edits introduce drift; targeted updates that mirror code changes don't.

A follow-up will mechanise this with bidirectional spec↔test linking (BDD-style tags, coverage report). Until that lands the rule is unmechanised — read the file, update it as you change things.
