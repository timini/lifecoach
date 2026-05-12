# Lifecoach Security Audit & Abuse-Resistance Report

Date: 2026-05-12
Scope: repository review of the public web proxy, Python agent API, Firebase auth flow, and Cloud Run Terraform for protections against unauthorized or unlimited billable LLM usage.

## Executive summary

The highest-risk issue was that the billable agent service was deployed as a public Cloud Run endpoint while production auth enforcement defaulted to off. A caller who discovered the agent URL could POST directly to `/chat` with an arbitrary `userId` and trigger Vertex/Gemini calls. The same billing risk also existed through the public web proxy if requests omitted or spoofed auth, because the proxy forwarded the request and the agent only treated auth as optional unless `REQUIRE_AUTH=true`.

This patch adds three immediate guardrails:

1. Production auth now defaults on in code and is explicitly set in dev and preview Terraform.
2. `/chat` has a per-instance fixed-window rate limit before the expensive model runner starts.
3. Free usage now has hard server-enforced turn caps for anonymous and signed-in free users; previous usage state only changed nudging/model choice and did not stop spend.

These controls materially reduce accidental bill shock and basic unauthenticated abuse, but they are not a complete substitute for Cloud Run IAM service-to-service invocation and durable centralized rate limiting.

## Methodology

- Static review of Next.js API proxy routes under `apps/web/src/app/api/**`.
- Static review of the Python FastAPI agent in `apps/agent_py/src/lifecoach_agent/server.py` and production wiring in `apps/agent_py/src/lifecoach_agent/main.py`.
- Review of Cloud Run Terraform in `infra/envs/dev/main.tf`, `infra/envs/preview/main.tf`, and `infra/modules/cloud-run-service/main.tf`.
- Targeted unit tests to simulate direct `/chat` abuse, rate limiting, and usage-cap enforcement.

## Findings

### Critical: public billable agent accepted unauthenticated chat turns

- Evidence: the agent Cloud Run service was configured with `allow_unauthenticated = true`.
- Evidence: production `require_auth` was controlled only by `REQUIRE_AUTH == "true"`; if unset, auth was optional.
- Impact: anyone with the agent URL could call `/chat` directly and trigger LLM requests using arbitrary `userId` / `sessionId` values.
- Fix: production app wiring now defaults `require_auth` to true, Terraform explicitly sets `REQUIRE_AUTH=true`, and direct calls without a verified Firebase bearer token are rejected before the runner executes.
- Residual risk: the agent is still publicly invokable at Cloud Run. Public invocation is now application-authenticated, but Cloud Run IAM would be stronger.

### High: no hard free-tier stop for billable LLM turns

- Evidence: `UsageStateMachine` changed model/nudge policy after thresholds, but there was no server-side refusal after a quota was exhausted.
- Impact: any valid free or anonymous Firebase user could continue generating model calls indefinitely.
- Fix: `/chat` now enforces `MAX_ANONYMOUS_TURNS` and `MAX_FREE_TURNS` after incrementing server-side metadata and before constructing/running the model.
- Defaults: anonymous users: 25 turns; signed-in free users: 100 turns; pro users are exempt.
- Residual risk: these are all-time per-UID caps backed by existing user metadata, not daily/monthly metering. If product requirements need rolling quotas, add a date-bucketed usage store.

### High: easy anonymous-account churn can bypass per-UID caps

- Evidence: the client intentionally supports Firebase anonymous auth so every visitor can get a valid token.
- Impact: an attacker can mint fresh anonymous Firebase users and receive a new per-UID quota.
- Fix in this patch: `/chat` now also has per-instance caller rate limiting so rapid abuse is throttled before model execution.
- Residual risk: in-memory per-instance rate limiting is not globally consistent across Cloud Run instances and can be bypassed with distributed IPs or enough time. Add a centralized Redis/Firestore/Cloud Armor quota if abuse is observed.

### Medium: web proxy forwards user-controlled IDs for read routes

- Evidence: `/api/chat/history`, `/api/profile`, and `/api/goals` accept `userId` query params and forward them to the agent.
- Mitigation: the agent overrides query/body user IDs with `claims.uid` when a token verifies.
- Risk: if auth enforcement regresses, these routes become cross-user data exposure points.
- Recommendation: make web routes fail fast when missing auth for any user-scoped endpoint, mirroring the existing workspace/profile write routes.

### Medium: public Cloud Run remains broader than necessary

- Evidence: the agent module is still `allow_unauthenticated = true` because the web route currently performs a plain fetch to the agent URL.
- Risk: application auth bugs are internet-exposed.
- Recommendation: migrate to service-to-service auth: remove `allUsers` from agent, grant only the web runtime service account `roles/run.invoker`, and have the web server mint a Google ID token for `AGENT_URL`. The chat proxy currently uses the Edge runtime, so this will likely require moving `/api/chat` to Node.js or adding a small server-side token-minting helper compatible with the runtime.

## Current controls after this patch

| Control | Status | Notes |
| --- | --- | --- |
| Firebase bearer token required for `/chat` in production | Enabled | Defaults true in production wiring and explicit in Terraform. |
| Token UID overrides body/query UID | Existing | Prevents spoofed `userId` when auth verifies. |
| Per-instance `/chat` rate limit | Added | Default 20 requests/minute/caller. |
| Anonymous hard turn cap | Added | Default 25 all-time turns per UID. |
| Free signed-in hard turn cap | Added | Default 100 all-time turns per UID. |
| Agent Cloud Run IAM private invocation | Not yet | Recommended next hardening. |
| Centralized distributed rate limiting | Not yet | Recommended for production-scale abuse defense. |
| Billing alerts / budget kill switch | Not in repo | Recommended in GCP billing console/Terraform. |

## Recommended next steps

1. Make the agent Cloud Run service private and use web-service-account authenticated invocation.
2. Add Cloud Billing budgets/alerts for Vertex AI spend, with low thresholds for dev/preview projects.
3. Replace in-memory rate limiting with a centralized, atomic limiter keyed by UID plus IP/device signals.
4. Add rolling daily/monthly quota documents instead of all-time counters if the product needs recurring free allowances.
5. Fail fast in all web API proxy routes when user-scoped requests lack a bearer token.
6. Add abuse dashboards for `rate_limited`, `anonymous_turn_limit_exceeded`, and `free_turn_limit_exceeded` events.

## Retest checklist

- Call `/chat` without `Authorization` in dev/preview: expect `401`.
- Call `/chat` more than `CHAT_RATE_LIMIT_PER_MINUTE` times in one minute from the same caller: expect `429`.
- Set a test anonymous user's `chatTurnCount` above `MAX_ANONYMOUS_TURNS`: expect `402` before any model event.
- Set a signed-in free user's `chatTurnCount` above `MAX_FREE_TURNS`: expect `402` before any model event.
- Verify pro users still receive model responses when above the free cap.
