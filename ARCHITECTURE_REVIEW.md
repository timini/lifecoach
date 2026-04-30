# Architecture Review (Security, Maintainability, Extensibility, Testability, Performance)

Date: 2026-04-30
Scope: repository-wide review with deep inspection of the runtime request path (`apps/web` proxy + `apps/agent` server/tooling/storage).

## Executive summary

The architecture is coherent and intentionally constrained: the state-machine-driven policy surface, shared schema contracts, and Terraform-first ops model are all strong foundations.

Primary security risk areas are not fundamental design flaws, but **hardening gaps around input validation and abuse controls** on chat/session endpoints and profile mutation paths. The most impactful near-term improvements are:

1. Enforce strict runtime validation for inbound API payloads (web + agent).
2. Add rate limits / abuse throttles per uid and IP at API edges.
3. Add explicit payload and parameter constraints for schema-free writes and generic workspace calls.
4. Improve observability around latency/error budgets with structured metrics.

## System strengths observed

- **Clear auth-plane separation for Workspace tokens**: tokens are stored server-side, never passed into LLM tool schemas, and process/env handling is deliberately sanitized in workspace command execution.
- **Single source of truth for capability gating**: `UserStateMachine` / `UsageStateMachine` reduces policy drift and accidental privilege surface expansion.
- **Prompt/context architecture matches constraints**: routine read context is pre-injected rather than exposed through read tools, reducing LLM tool call overhead and reducing authorization complexity.
- **Monorepo contracts are explicit**: shared types + tests across apps improve consistency and reduce integration defects.

---

## Security review

### What is working well

- Bearer extraction/verification is centralized and defensive (`verifyRequest` returns null on verifier errors).
- Session and profile reads are scoped with token-derived uid where present.
- Workspace tool path uses `execFile` (no shell interpolation) and sanitizes stderr/stdout logging samples.
- Token refresh path includes single-flight mutex per uid and deletes stale creds on refresh failure.

### Key risks and recommendations

1. **Insufficient runtime input validation on edge-facing JSON bodies**
   - `apps/web/src/app/api/chat/route.ts` and several agent handlers rely on light shape checks, but no strict schema parse for field type/length bounds.
   - Risk: oversized strings, malformed nested values, and edge-case coercions can bypass assumptions and impact reliability/security.
   - Recommendation: enforce `zod` parse at all route boundaries (web + agent), with max lengths for `message`, bounded coordinate precision/range, and safe defaults.

2. **Potential abuse/DoS through unthrottled chat and tool invocations**
   - No built-in per-user/per-origin rate controls are visible in the request path.
   - Risk: cost amplification (LLM/tool/API) and service degradation.
   - Recommendation: add layered limits: Cloud Run / API gateway quota + in-app uid token bucket + session concurrency caps.

3. **Schema-free profile path mutation needs guardrails**
   - `updatePath` accepts arbitrary dotted paths and values.
   - Risk: unbounded doc growth, deeply nested structures, and latent prompt-injection persistence vectors.
   - Recommendation: add path allowlist/denylist rules, depth limits, value size caps, and profile document size budget enforcement.

4. **Cross-user data scoping depends on optional `requireAuth` wiring**
   - The server supports optional auth mode for tests/dev. In production this is expected true, but the risk is misconfiguration.
   - Recommendation: fail fast on startup when `NODE_ENV=production` and auth dependencies are missing/disabled.

5. **SSE proxy error normalization may hide actionable failure classes**
   - Web route maps upstream errors to 502 with truncated detail.
   - Recommendation: preserve typed upstream error code in machine-readable JSON while keeping safe redaction for clients.

---

## Maintainability review

### Strengths

- Good module boundaries (`context`, `storage`, `tools`, `prompt`, `oauth`).
- Test-first culture and high coverage target support long-term evolution.
- Invariants are documented in `CLAUDE.md` and echoed in `README.md`.

### Improvement opportunities

1. **Route handler repetition**
   - Repeated auth + error boilerplate in `apps/agent/src/server.ts` suggests extracting reusable middleware/handler wrappers.
2. **Contract drift risk in comment-only assumptions**
   - Some operational assumptions (timeouts, payload caps, cache durations) are embedded in comments/constants but not centrally policy-managed.
   - Add shared config module for server limits, timeouts, and cache TTLs.
3. **Logging consistency**
   - Standardize structured logging schema (request_id, uid_hash, endpoint, latency_ms, upstream_code) across web + agent.

---

## Extensibility review

### Strengths

- State machine policy model is an excellent extension point for adding new auth tiers/tools.
- Tool architecture with dependency injection supports incremental capabilities.
- Terraform module decomposition supports incremental infra growth.

### Improvement opportunities

1. **Generic workspace dispatch increases coupling to CLI semantics**
   - Consider introducing a thin typed adapter layer per service operation for high-frequency actions, keeping generic fallback for long tail.
2. **Profile schema evolution strategy**
   - Current schema-free approach is flexible but makes downstream analytics/features harder.
   - Introduce a progressive typing strategy (optional typed namespaces + migration helpers).
3. **Prompt assembly scalability**
   - `buildInstruction` context may continue growing; move to composable prompt sections with explicit token budgets per section.

---

## Testability review

### Strengths

- Extensive use of interfaces and injectable deps (`RunnerLike`, `ExecFileLike`, stores, clients).
- Good unit-test surface in storage/tools/context modules.

### Gaps and recommendations

1. **Need route-contract tests for malformed payloads**
   - Add negative tests for oversized/invalid chat payloads, invalid location ranges, and malformed workspace params JSON.
2. **Need auth-misconfiguration tests**
   - Add production-mode startup tests that assert fail-fast behavior when auth is disabled.
3. **Add resilience tests for concurrency and retries**
   - Focus on simultaneous chat turns, workspace token refresh races, and SSE disconnect/reconnect churn under load.

---

## Performance review

### Strengths

- Parallel context fetching with timing helpers is a strong baseline.
- SSE streaming design avoids full-response buffering.

### Risks and recommendations

1. **Tail latency from context fan-out**
   - Parallel fan-out still bound by slowest dependency; introduce strict per-provider timeout budgets and partial-context fallback markers.
2. **Session event growth**
   - Firestore session docs with unbounded event arrays can hit document size/read amplification ceilings.
   - Use chunked event collections or rolling window snapshots.
3. **Workspace CLI subprocess overhead**
   - Process spawn per tool call is robust but can be expensive at scale.
   - Benchmark call rates; consider pooled service adapter for hot-path methods.
4. **Prompt size growth cost**
   - Large injected context can increase token latency/cost.
   - Add prompt section budget enforcement and telemetry (`input_tokens_by_section`).

---

## Prioritized action plan (next 2 sprints)

### Sprint 1 (high impact, low-to-medium effort)

1. Add strict zod validation to all external route boundaries.
2. Add per-uid and per-IP rate limits for `/chat` and `/workspace/*`.
3. Add profile write guardrails (max doc size, path depth, value size).
4. Add production startup invariant checks (`requireAuth`, verifier presence).

### Sprint 2 (medium effort)

1. Refactor route auth/error boilerplate into middleware.
2. Add structured observability baseline + latency/error SLO dashboards.
3. Add session event storage compaction strategy.
4. Add prompt token-budget instrumentation and section caps.

---

## Files reviewed (representative)

- `README.md`
- `CLAUDE.md`
- `apps/agent/src/server.ts`
- `apps/agent/src/auth.ts`
- `apps/agent/src/storage/workspaceTokens.ts`
- `apps/agent/src/storage/userProfile.ts`
- `apps/agent/src/tools/callWorkspace.ts`
- `apps/web/src/app/api/chat/route.ts`
- `turbo.json`
- `justfile`
