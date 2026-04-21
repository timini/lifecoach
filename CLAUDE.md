# Lifecoach — AI Assistant Guide

This document is for AI coding assistants (Claude Code, etc.) working in this repository. Humans should also read it, but its primary audience is the model.

## What this project is

AI life coaching web app. Two deployables:
- `apps/web` — Next.js 15 on Firebase App Hosting
- `apps/agent` — Google ADK for TypeScript agent (Gemini 3.1 Pro) on Cloud Run

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

## Commit and PR discipline

- One logical change per PR. A PR that touches the state machine should not also reformat unrelated files.
- Tests in the same commit as the code they test.
- PR title: imperative, under 70 chars. Body explains *why*, not *what* — the diff shows what.
- Pre-commit hooks (Biome, typecheck, test, no-IP guard) must pass before commit. Do not `--no-verify`.

## Directory conventions

- `apps/web/src/lib/*` — client-safe utilities (can import from `packages/shared-types`, `packages/user-state`).
- `apps/web/src/app/api/*/route.ts` — server-only Next.js route handlers. Never import browser-only modules here.
- `apps/agent/src/tools/*` — one tool per file. Pure functions over injected dependencies (GCS client, clock, fetcher). Never `new GoogleCloudStorage()` inside a tool; accept it as a constructor argument.
- `apps/agent/src/context/*` — cached context providers (weather, places). Cache keys are documented at the top of each file.
- `packages/*/src/index.ts` — each package has one barrel export.

## Running things

All routine tasks go through `just`:

```bash
just install         # pnpm install
just dev             # web + agent concurrently
just test            # all tests
just coverage        # enforce 90% gate
just lint            # biome --write
just typecheck       # tsc -b
just e2e             # playwright
```

Don't invent new scripts in root `package.json` for one-off work — add a recipe to the Justfile if it's routine, otherwise just type the command.

## Secrets

Never commit secrets. Local dev uses `.env.local` (gitignored). Production uses GCP Secret Manager, wired through Terraform. If a test needs a credential, it uses a fake in `packages/testing`.
