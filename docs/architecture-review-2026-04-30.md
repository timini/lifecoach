# Lifecoach Architecture Review (2026-04-30)

Scope: security, maintainability, extensibility, testability, performance.

## Executive summary

Overall architecture is strong: clear app split (`apps/web`, `apps/agent`), good type contracts (`packages/shared-types`), explicit state machine policy (`packages/user-state`), and broad automated tests. The largest risk area is **authorization consistency** and **operational hardening around streaming + external dependencies**, not core code quality.

### Top priorities

1. **Harden identity boundary further in chat path** with explicit anti-confusion checks (`claims.uid` must match requested `userId` when both present) and audit logging for mismatches.
2. **Add dependency timeouts/circuit-breaker policy standardization** for context providers (weather/places/memory/workspace) and make fallback behavior contractually tested.
3. **Formalize threat model + security checklist in-repo** and wire it into PR template/CI quality gates.
4. **Improve performance observability** with per-stage SLOs (prompt assembly time, provider latency, first-token latency, full-turn latency).

---

## 1) Security review

## Strengths

- Auth verification exists in agent routes and `requireAuth` can enforce authenticated-only access; handlers derive an effective uid from verified claims when present.
- Web API route for chat only proxies bearer token to agent and does not perform privileged logic.
- Explicit architectural policy forbids IP geolocation and forbids context read-tools, reducing unexpected sensitive access surface.
- Shared schemas and centralized state policy reduce auth/business-logic drift.

## Risks / gaps

### S1. Potential UID confusion/path-of-least-resistance risk (Medium)

Even though the code already computes `effectiveUserId = claims?.uid ?? userId`, callers can still send a mismatching `userId` when authenticated. This appears safe functionally, but it leaves room for:
- ambiguous logs,
- future regressions in downstream code that accidentally trusts request body fields,
- weaker forensic clarity.

**Recommendation:** reject authenticated requests where `userId` is present and differs from `claims.uid` (400/403), and log mismatch metric.

### S2. Broad external dependency trust without explicit centralized resiliency policy (Medium)

Chat turn builds context via multiple external providers (weather, places, memory, workspace), and failures are generally caught/fallback’d. Good start, but no single policy defines:
- max timeout per provider,
- retry behavior,
- fail-open vs fail-closed semantics per provider,
- degraded-mode prompt marker.

**Recommendation:** implement a shared "provider policy" module used by all context fetchers and enforce tests for timeout/degraded behavior.

### S3. OAuth/workspace token lifecycle controls should be explicitly reviewable (Medium)

Architecture integrates workspace OAuth and Secret Manager/Firestore, but rotation/revocation/reporting requirements are not clearly codified in one security control doc.

**Recommendation:** add `docs/security-controls.md` with token storage, encryption boundary, revocation workflow, rotation cadence, and incident response steps.

### S4. SSE transport hardening opportunities (Low/Medium)

SSE proxying is correctly configured for streaming, but add explicit security headers and connection-limit safeguards at ingress/app level for abuse resistance.

**Recommendation:** document and enforce max concurrent streams per uid/IP (at edge/load-balancer level), plus request-size and stream-duration caps.

---

## 2) Maintainability review

## Strengths

- Monorepo layering is clean and understandable.
- Domain concepts are explicit (`context`, `tools`, `storage`, `prompt`, `oauth`).
- High-level architecture and invariants are well documented.
- State machines as source-of-truth reduce scattered conditional logic.

## Risks / gaps

### M1. Architecture decisions are documented, but not in ADR format (Low)

Current docs are strong but could age without decision records.

**Recommendation:** add lightweight ADRs for major decisions (prompt-injected context vs read tools, SSE proxy design, state-machine gating, auth enforcement mode).

### M2. Route-level logic density in `server.ts` (Medium)

`apps/agent/src/server.ts` centralizes many handlers and orchestration concerns. This can slow onboarding and increase regression blast radius.

**Recommendation:** split by bounded modules:
- `routes/chat.ts`
- `routes/profile.ts`
- `routes/workspace.ts`
- shared middleware (`authGuard`, `requestValidation`, `errorMap`).

---

## 3) Extensibility review

## Strengths

- `runnerFor` factory + dependency injection enables adding new tools/providers without rewriting server core.
- `packages/shared-types` + package boundaries support safer cross-app evolution.
- State machine policy model creates a good extension seam for future tiers/states.

## Risks / gaps

### E1. Tool registration and policy coupling may become complex with growth (Medium)

As tool count rises, ensuring coherent availability across user state + usage state can become brittle.

**Recommendation:** define a declarative tool catalog (capabilities matrix) with static assertions/tests that each state maps to a valid tool subset.

### E2. Prompt assembly can accumulate hidden coupling (Medium)

Prompt-injected context is a strong strategy, but additions can bloat instructions and create subtle behavior shifts.

**Recommendation:** modularize prompt sections with explicit token budgets and per-section tests/snapshots; add guardrails for max prompt size.

---

## 4) Testability review

## Strengths

- Repo contains broad unit coverage across routes, tools, context providers, and packages.
- TDD and coverage expectations are clearly stated.
- Dependency injection surfaces (`runnerFor`, stores/clients) support deterministic tests.

## Risks / gaps

### T1. Missing explicit non-functional test suite (Medium)

Functional tests are strong; non-functional tests (load, soak, auth abuse, timeout behavior) are less visible.

**Recommendation:** add:
- contract tests for all API error codes,
- resilience tests (provider timeout cascade),
- load tests for SSE (first-token + stream completion),
- security tests (uid mismatch, malformed token, oversized payload).

### T2. End-to-end security regression pack should be explicit (Low/Medium)

**Recommendation:** create a dedicated `security.e2e` suite that runs in CI nightly (or pre-release) for authz/authn, workspace scope checks, and token-revocation behavior.

---

## 5) Performance review

## Strengths

- Streaming design (Edge proxy + SSE forwarding) is appropriate for conversational latency.
- Parallel context prefetch appears present in `/chat` flow and timing helper exists (`timed`).
- History recovery model improves UX resilience.

## Risks / gaps

### P1. No explicit SLO/SLA codification in repo docs (Medium)

Without explicit budgets, optimization work is ad hoc.

**Recommendation:** define measurable objectives:
- P50/P95 first-token latency,
- P95 context assembly latency,
- P95 end-to-end turn completion,
- provider error budget.

### P2. Potential prompt/context growth over time (Medium)

As memories, profile, goals, and dynamic context expand, token and latency costs can drift.

**Recommendation:** enforce caps/summarization policies per context source and add telemetry for prompt token size by section.

---

## Suggested 30/60/90-day roadmap

### 0–30 days
- Add uid mismatch rejection + metric.
- Add centralized provider timeout/retry/fallback policy.
- Publish security controls doc.
- Add baseline latency dashboards for turn stages.

### 31–60 days
- Refactor agent routes into modules.
- Add tool-catalog policy assertions.
- Add performance/resilience test harness for SSE and provider failures.

### 61–90 days
- Introduce ADR process.
- Add prompt section token budgets + automated drift checks.
- Run threat-model review and tabletop incident exercise.

---

## Overall rating

- **Security:** B+ (strong foundation; needs stricter boundary checks + explicit controls)
- **Maintainability:** A- (clear structure; reduce central route complexity)
- **Extensibility:** A- (good DI/state seams; add declarative tool governance)
- **Testability:** A- (excellent unit posture; expand non-functional coverage)
- **Performance:** B+ (good streaming architecture; add hard SLOs + token-budget controls)
