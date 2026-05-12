# Security Audit and Abuse-Prevention Report

Date: 2026-05-12
Scope: `apps/agent_py` FastAPI agent, `apps/web` Next.js API proxy routes, Firebase-authenticated chat flows, usage metering, and LLM billing-abuse controls.

## Executive summary

The highest-risk issue was that the billable `/chat` endpoint depended on optional authentication and had only model downgrading after free usage thresholds. In a production configuration with `REQUIRE_AUTH` unset or false, a caller could submit arbitrary `userId` values, reset usage counters by rotating IDs, and continue invoking LLM calls. Even with authentication enabled, free and anonymous users were never hard-stopped; they were only moved to a cheaper model after the threshold.

This change hardens the billing boundary by:

1. Defaulting the production agent to require Firebase ID-token verification unless explicitly disabled with `REQUIRE_AUTH=false`.
2. Adding an optional shared internal bearer (`AGENT_INTERNAL_BEARER`) between the Next.js API proxy and the agent so direct public calls to the agent can be rejected before billable work.
3. Adding hard free-tier turn limits before runner/LLM invocation: anonymous users default to 25 turns and signed-in free users default to 100 turns. Pro users remain exempt.
4. Forwarding the internal bearer from all web API proxy routes to the agent.
5. Adding regression tests for direct-agent internal bearer enforcement and free anonymous turn-limit enforcement.

## Threat model tested

### Assets

- Gemini/ADK LLM spend behind the Python agent.
- User profile, goal, session, and workspace-token-backed data.
- Google Workspace OAuth refresh tokens and scopes.

### Relevant attacker goals

- Call the agent or web proxy repeatedly to obtain unlimited LLM completions.
- Spoof another `userId` to read or spend against another account.
- Bypass free-tier controls by rotating request body IDs or unauthenticated sessions.
- Abuse workspace endpoints without an authenticated Firebase user.

### Assumptions

- The browser app signs users into Firebase, including anonymous users, before chat.
- The agent may be reachable independently from the Next.js app depending on deployment exposure.
- Firebase client configuration is public by design, so Firebase ID tokens authenticate users but are not by themselves an app-origin control.

## Findings and remediation status

### Finding 1 — Critical: unauthenticated or direct agent calls could reach billable `/chat`

**Status:** Fixed in code; requires deployment configuration for full direct-call protection.

**Evidence:** The production app previously used `require_auth=os.environ.get("REQUIRE_AUTH") == "true"`, which meant authentication was not required unless the variable was explicitly set to `true`. The server also accepted unauthenticated chat by falling back to `effective_user_id = user_id` from the request body when claims were absent.

**Impact:** If the agent URL is public or discoverable, an attacker could call `/chat` without a valid Firebase token in configurations where `REQUIRE_AUTH` was not set to `true`. They could also rotate `userId` values to create fresh usage counters.

**Remediation:** The agent now defaults closed with `require_auth=os.environ.get("REQUIRE_AUTH", "true") != "false"`. Leave this default enabled in production. Only set `REQUIRE_AUTH=false` for isolated local/dev environments that cannot reach paid model credentials.

### Finding 2 — Critical: free users were never hard-capped

**Status:** Fixed.

**Evidence:** The usage state machine moved anonymous heavy users to a cheaper model after 15 turns but continued to return a model policy. There was no code path that blocked LLM execution after a maximum number of free turns.

**Impact:** Any authenticated anonymous or free account could continue invoking the LLM indefinitely, producing unbounded spend at the cheaper or normal model tier.

**Remediation:** The server now enforces hard free-tier turn limits after the usage counter increments and before `runner_for(...)` is called. Defaults:

- `FREE_ANONYMOUS_TURN_LIMIT=25`
- `FREE_SIGNED_IN_TURN_LIMIT=100`

When exceeded, the agent returns HTTP 429 with `free_usage_limit_exceeded`, and the runner is not invoked.

### Finding 3 — High: Firebase ID tokens do not prevent direct agent API abuse

**Status:** Mitigated in code; must set `AGENT_INTERNAL_BEARER` in both web and agent deployments.

**Evidence:** Firebase anonymous sign-in is intentionally available to the web client. An attacker who obtains a valid Firebase anonymous token could call the agent directly if the agent is public.

**Impact:** Per-user hard caps limit each UID, but an attacker may create many anonymous Firebase users unless Firebase-side abuse protections and app-origin checks are also enabled.

**Remediation:** The agent now supports `AGENT_INTERNAL_BEARER`. If set, private/billable endpoints require `x-agent-internal-bearer` to match. All Next.js API proxy routes now forward this header when configured.

**Deployment requirement:** Generate a high-entropy secret and set the same value in the agent service and web service. Do not expose it as a `NEXT_PUBLIC_*` value.

### Finding 4 — Medium: web proxy forwards upstream errors as 502 on chat

**Status:** Existing behavior; acceptable but monitor.

**Evidence:** The `/api/chat` route converts any upstream status >= 400 to a 502 with a capped detail body. This means a quota 429 from the agent is not surfaced as 429 to the browser today.

**Impact:** Billing is protected because the block happens in the agent before runner invocation, but UX may show a generic upstream error instead of a quota-specific upgrade/sign-in prompt.

**Recommendation:** In a follow-up, preserve agent 401/429 statuses in `/api/chat` and map `free_usage_limit_exceeded` to a user-facing upgrade/sign-in CTA.

### Finding 5 — Medium: in-process limits are per UID, not per device/IP/payment method

**Status:** Partially mitigated.

**Evidence:** The new hard caps are keyed by `userMeta/{uid}`. Firebase anonymous churn can still create many UIDs.

**Impact:** Attackers may distribute usage across many anonymous accounts.

**Recommendations:**

- Enable Firebase App Check for web clients and verify App Check tokens server-side.
- Consider Cloud Armor, Cloud Run ingress restrictions, or private service-to-service ingress so only the web backend can reach the agent.
- Add per-IP/device/request-rate controls at the edge.
- Add billing alerts and model/provider-side quotas.
- Consider requiring verified email or payment before expensive model access.

## Pen-test checklist performed

| Test | Expected result | Result |
| --- | --- | --- |
| POST `/chat` without `x-agent-internal-bearer` when `internal_bearer` is configured | HTTP 401 before runner invocation | Passed by unit test |
| POST `/chat` with matching internal bearer | Request can proceed | Passed by unit test |
| Anonymous free user above configured turn limit | HTTP 429 and runner not called | Passed by unit test |
| Authenticated request with body `userId` spoofing another user | Token UID is used for scoped reads | Existing test still passes |
| Workspace status without Firebase auth | HTTP 401 | Existing test still passes |
| Profile writes without Firebase auth | HTTP 401 | Existing behavior retained |

## Production hardening checklist

1. Set `REQUIRE_AUTH=true` or leave it unset. Do not set `REQUIRE_AUTH=false` in production.
2. Set the same high-entropy `AGENT_INTERNAL_BEARER` secret in the web and agent services.
3. Restrict the agent service ingress so direct internet traffic cannot reach it where possible.
4. Set conservative initial values for `FREE_ANONYMOUS_TURN_LIMIT` and `FREE_SIGNED_IN_TURN_LIMIT` until billing telemetry is proven.
5. Add provider-side spend limits, daily budget alerts, and anomaly alerts on request count, token count, and 429 rate.
6. Enable Firebase App Check and verify App Check tokens before proxying chat requests.
7. Add user-facing quota/upgrade UI for `free_usage_limit_exceeded`.

## Residual risk

The code now prevents unlimited usage per Firebase UID and can block direct agent calls when `AGENT_INTERNAL_BEARER` is deployed. The main remaining risk is automated creation of many anonymous Firebase users through the legitimate web route. That should be addressed with App Check verification, edge rate limiting, Cloud Armor/ingress restrictions, and spend alerts.
