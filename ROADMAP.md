# Lifecoach — Roadmap

Twelve-phase build plan. Each phase ends with a demoable checkpoint, passing tests, and green CI.

Status legend: ✅ shipped · 🟡 in progress · ⬜ not started

## Phase 0 — Foundation ✅
*No product yet — the scaffolding the rest of the build sits on.*
- pnpm monorepo skeleton, Turborepo, Biome, Vitest, Lefthook
- `CLAUDE.md` with TDD rules
- Justfile with `install`, `dev`, `test`, `lint`, `typecheck`
- GitHub Actions `ci.yml` running on empty packages
- **Checkpoint:** `just test` passes on empty scaffolding; CI green on PR.

## Phase 1 — Deployable "hello world" ✅
- Next.js app with a single `/` page, deployed to Firebase App Hosting (dev)
- ADK agent with `root_agent` that echoes input, deployed to Cloud Run (dev)
- Next.js `/api/chat` proxies to the agent
- Terraform for both environments (apply for dev only)
- **Checkpoint:** public dev URL; typing in the browser reaches Gemini and returns a streamed reply.

## Phase 2 — Anonymous auth & session ✅
- Firebase Auth anonymous sign-in on load
- UID propagated to `/api/chat`
- Agent receives `uid` in context
- `UserStateMachine` introduced as the single source of truth
- **Checkpoint:** each browser gets a stable UID; visible in agent logs.

## Phase 3 — Live context injection ✅
- Browser geolocation **only** (IP fallback explicitly rejected — see CLAUDE.md invariants)
- Open-Meteo client with 30-min cache
- `buildInstruction()` assembles time + location + weather into the system prompt
- **Checkpoint:** coach says things like "nice morning in Melbourne for a walk" without being asked.

## Phase 4 — User profile write loop ✅
- Per-UID storage provisioned
- `user.yaml` read on session start, injected verbatim (nulls included)
- `update_user_profile` tool with dotted-path writes
- Schema-free YAML (coach invents keys; UI renders generic tree)
- **Checkpoint:** tell coach "I have two kids"; refresh page; coach remembers.

## Phase 5 — Goals ✅
- `goal_updates.json` read (last 20) into prompt
- `log_goal_update` tool
- Per-turn tool-call telemetry
- **Checkpoint:** logging a run progresses the goal; coach references it next session.

## Phase 6 — Interactive UI tools ✅
- `ask_single_choice_question` and `ask_multiple_choice_question` streamed as structured events
- Frontend renderers (radio / checkbox) inline in chat
- **Checkpoint:** onboarding flow uses choice tools to fill profile with minimal typing.

## Phase 7 — Nearby places ✅
- Google Places client (Places API New) with 60-min cache
- Injected into prompt
- **Checkpoint:** coach suggests a specific nearby park for the user's running goal.

## Phase 8 — Memory bank ✅
- Persistent memory via **mem0** (Vertex Memory Bank not available for the TS ADK)
- Graceful no-op fallback when mem0 not configured
- Memory protocol baked into system prompt — silent search, silent save
- **Checkpoint:** returning user is recognized with context from prior sessions; no "I'm checking memory" announcements.

## Phase 9 — Auth upgrade ✅
- `auth_user` tool + frontend handlers
- Anonymous → email and anonymous → Google via `linkWithCredential` / `linkWithPopup`
- Welcome email path
- New states: `email_pending`, `email_verified`, `google_linked`
- **Checkpoint:** user can upgrade without losing conversation or profile.

## Phase 10 — Google Workspace 🟡
- **Architectural invariant:** the LLM never touches auth — no codes, tokens, refresh tokens, expiries; all owned by the application
- `connect_workspace` UI-directive tool (LLM emits, client renders Connect button)
- `call_workspace({service, resource, method, params})` generic dispatch — one tool covers Gmail, Calendar, Tasks
- Full scopes (`mail.google.com/`, `calendar`, `tasks`)
- Server-side token store in Firestore `workspaceTokens/{uid}` with per-uid refresh mutex
- Underlying invocation: `gws` CLI (musl-static) via `execFile` with token in env
- Streaming SSE + `ToolCallBadge` pills for live tool-call feedback
- **Checkpoint:** "what's on my calendar today?" works end-to-end.
- **Outstanding:** `gws` exits with code 4 on `messages.list` — diagnostic logs added in `95009e3`, awaiting next user retry to surface root cause.

## Phase 11 — Production hardening ⬜
- Prod Terraform apply
- Error tracking (Sentry), structured logs, Cloud Monitoring dashboards
- 90% coverage gate enforced in CI *(already done mid-stream)*
- Playwright e2e in deploy pipeline
- Rate limits on `/api/chat` keyed by UID
- **Checkpoint:** prod URL live; runbook in `docs/`.

---

## Side-quests shipped along the way

These weren't numbered phases but were committed as their own work:

- `phase-ui-1` — Tailwind v4 + `packages/ui` + Gemini 3 Flash
- `phase-ui-2` — Generative UI via `@openuidev/react-lang`
- `phase-account-ux` — `AccountMenu` + `/settings` page + tabs
- Persistent sessions via Firestore (between phase-8 and phase-9)
- Coverage gate raised to 90% (mid-build, pulled forward from Phase 11)

## Source

The original 12-phase plan was drafted in-conversation on 2026-04-21 before any code was written. This file is its first persisted form.
