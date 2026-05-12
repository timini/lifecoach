# Security audit and abuse-prevention report

Date: 2026-05-12
Scope: `apps/web` Next.js API proxy, `apps/agent_py` FastAPI agent, Firebase-authenticated chat/session/profile/workspace flows, and LLM spend controls.

## Executive summary

The primary billing-abuse risk was that the Python agent could be called directly and, unless `REQUIRE_AUTH=true` was set, would accept caller-supplied `userId` values for `/chat`. In addition, the usage state machine downgraded anonymous users to a cheaper model after a threshold, but it did not enforce a hard stop for free users. A caller could therefore create unbounded turns and run up LLM costs.

This patch adds three controls:

1. **Production auth defaults to on.** `REQUIRE_AUTH` now defaults to required unless explicitly set to `false`.
2. **Internal app-to-agent shared secret.** If `AGENT_SHARED_SECRET` is configured on both services, all non-health agent endpoints require `x-lifecoach-agent-secret`, and the Next.js API routes forward it. This blocks direct public calls to the agent Cloud Run URL.
3. **Hard free-turn limit.** Production enables usage-limit enforcement by default. Free-tier `/chat` requests are rejected with `429 free_turn_limit_exceeded` after `LIFECOACH_FREE_TURN_LIMIT` turns, before the LLM runner is created.

## Methodology

- Reviewed authentication and authorization paths for all FastAPI endpoints.
- Traced web proxy behavior to confirm whether browser-provided Firebase ID tokens reach the agent.
- Reviewed usage metering and model-selection logic for unlimited-turn conditions.
- Reviewed workspace OAuth endpoints for token exposure and direct-access risk.
- Added focused tests for direct-agent bypass prevention and free-turn cap enforcement.

## Findings

### 1. Critical: direct agent access could bypass the web API proxy

**Status:** Fixed.

**Impact:** If the agent service URL is reachable, an attacker could call `/chat` directly. Before this patch, the agent only required Firebase auth when `REQUIRE_AUTH=true`, and production wiring defaulted that flag to false unless explicitly configured. That allowed unauthenticated calls to spend LLM tokens using arbitrary `userId` values.

**Fix:** Production now defaults `REQUIRE_AUTH` to enabled. The agent also supports `AGENT_SHARED_SECRET`; when configured, all non-health endpoints reject missing or mismatched `x-lifecoach-agent-secret` before request parsing or LLM execution. The web API proxy forwards the same secret to the agent.

**Deployment requirement:** Set the same high-entropy `AGENT_SHARED_SECRET` on the web service and agent service. Treat it like a password and rotate if exposed.

### 2. Critical: no hard free-tier LLM quota

**Status:** Fixed.

**Impact:** The existing usage policy downgraded anonymous users to `gemini-flash-lite-latest` after a threshold, but did not stop free usage. Downgrading reduces per-turn cost but does not prevent unlimited spend.

**Fix:** The agent now rejects free-tier chat once `chatTurnCount` exceeds `LIFECOACH_FREE_TURN_LIMIT` when `ENFORCE_USAGE_LIMITS` is enabled. Production enables this by default. Rejection occurs before `runner_for(...)`, so no LLM request is made for over-limit free users.

**Deployment requirement:** Keep `ENFORCE_USAGE_LIMITS` unset or set to `true`; configure `LIFECOACH_FREE_TURN_LIMIT` to the desired budget threshold. The default is 100 turns.

### 3. High: user-supplied `userId` must never scope authenticated reads

**Status:** Existing control verified.

**Impact:** If authenticated requests used body/query `userId`, users could read or mutate another user's data.

**Observed control:** The agent replaces caller-supplied `userId` with Firebase `claims.uid` whenever auth is present. Existing tests cover this for `/chat` profile reads.

**Residual risk:** If auth is disabled, `userId` remains caller-controlled. This is mitigated by the production auth default change and the internal shared secret.

### 4. Medium: workspace OAuth token handling

**Status:** Existing control verified; protected by shared secret.

**Observed controls:** Workspace endpoints require Firebase auth. The OAuth exchange response only returns connection metadata, and the error log redacts Google access-token-looking strings. The web proxy avoids echoing upstream OAuth exchange errors.

**Residual risk:** Workspace token storage remains a high-value target. Confirm Firestore IAM permits only the agent runtime service account and trusted admins.

### 5. Medium: abuse from many fresh Firebase anonymous accounts

**Status:** Partially mitigated.

**Impact:** A determined attacker who can reach the public web app may still mint fresh anonymous Firebase accounts and consume the per-UID free quota repeatedly.

**Recommended next steps:** Add an IP/device/browser risk throttle at the public web edge or API gateway, for example Cloud Armor rate limiting, reCAPTCHA Enterprise/App Check, or a server-side per-IP quota store. The app-to-agent secret prevents bypassing the web tier, but the web tier still needs public-abuse throttling.

## Pen-test scenarios run against the code

| Scenario | Expected result | Coverage |
| --- | --- | --- |
| Direct `POST /chat` to agent without shared secret while `internal_api_secret` is configured | `403`, no runner call | Unit test added |
| Direct `POST /chat` with matching shared secret | Stream succeeds | Unit test added |
| Free user above hard limit | `429`, no runner call | Unit test added |
| Browser `/api/chat` proxy with configured secret | Secret forwarded to agent | Unit test added |
| Authenticated chat with spoofed body `userId` | Token UID wins | Existing unit test retained |

## Operational checklist

- [ ] Set `AGENT_SHARED_SECRET` on both web and agent deployments.
- [ ] Ensure the agent service is not intentionally public unless the shared secret is enabled.
- [ ] Keep `REQUIRE_AUTH` enabled. Do not set `REQUIRE_AUTH=false` in production.
- [ ] Keep `ENFORCE_USAGE_LIMITS` enabled. Do not set `ENFORCE_USAGE_LIMITS=false` in production.
- [ ] Set `LIFECOACH_FREE_TURN_LIMIT` based on your acceptable free-tier budget.
- [ ] Add web-edge rate limiting / App Check / reCAPTCHA Enterprise to address repeated anonymous-account creation.
- [ ] Monitor `chat.turn` logs for `usageState`, `tier`, and `chatTurnCount`, and alert on 429 spikes or abnormal UID creation rates.
