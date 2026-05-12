# Security Audit and Penetration Test Report

Date: 2026-05-12  
Scope: `apps/web` Next.js API proxy, `apps/agent_py` FastAPI agent service, auth/session/profile/workspace endpoints, and usage/billing controls.

## Executive Summary

The highest-risk issue found was that the chat API relied on usage nudges and model downgrade behavior, but did not enforce a hard server-side LLM cutoff for free users. A malicious client with a valid Firebase anonymous token, or a deployment with `REQUIRE_AUTH` disabled, could keep invoking `/chat` and consume LLM quota indefinitely. This audit adds a hard deny policy before any LLM runner is constructed.

Current protections added in this change:

- Anonymous free users are blocked at `ANONYMOUS_HARD_LIMIT_AFTER` turns.
- Signed-in free users are blocked at `FREE_HARD_LIMIT_AFTER` turns.
- Blocked turns return HTTP `429` with `Retry-After: 86400` and do not build or call the LLM runner.
- The web API proxy preserves upstream `429` responses instead of converting them to `502`.
- The chat UI now surfaces a friendly limit message instead of leaving an empty assistant response.

## Test Methodology

### Static Review

Reviewed authentication, authorization, usage metering, storage scoping, and chat request flow in:

- `apps/web/src/app/api/chat/route.ts`
- `apps/web/src/lib/useChatStream.ts`
- `apps/agent_py/src/lifecoach_agent/server.py`
- `apps/agent_py/src/lifecoach_agent/auth.py`
- `apps/agent_py/src/lifecoach_agent/storage/user_meta.py`
- `apps/agent_py/src/lifecoach_agent/state/usage_state.py`
- `packages/user-state/src/UsageStateMachine.ts`

### Abuse-Case Pen Test Simulation

The audit modeled these adversarial flows:

1. **Unlimited anonymous LLM consumption**: repeatedly call `/chat` as an anonymous user.
2. **Client `userId` spoofing**: submit a different `userId` in the request body while authenticated as another UID.
3. **Free signed-in quota bypass**: continue calls after pro-pitch threshold without upgrading.
4. **Direct agent service calls**: bypass the web proxy and call FastAPI `/chat` directly.
5. **Upstream error masking**: verify that quota denials are preserved through the Next.js proxy.
6. **Sensitive token disclosure**: inspect OAuth workspace token endpoints for token echoing.

## Findings

### Critical: Missing Hard LLM Usage Limit for Free Users

**Status:** Fixed in this change.  
**Risk:** High billing impact.  
**Affected area:** FastAPI `/chat`, usage policy state machine.

Before the fix, `free_throttled` only downgraded anonymous users to a cheaper model and signed-in users only received a pro nudge. Neither state blocked further LLM execution. This left the service vulnerable to runaway LLM spend.

**Remediation implemented:**

- Added `free_blocked` and `free_signed_in_blocked` states.
- Added `llm_allowed` and `limit_message` to usage policy output.
- Moved usage metering before expensive context fetches and LLM runner creation.
- Return `429` immediately when `llm_allowed` is false.

**Residual risk:** The current counters are lifetime turn counters, not rolling daily quotas. That is safer for spend containment but may be stricter than desired for user experience. If you want daily/weekly quotas, implement a transactional per-window counter.

### High: Production Safety Depends on `REQUIRE_AUTH=true`

**Status:** Partially mitigated; operational action required.  
**Risk:** High if disabled in production.  
**Affected area:** Direct FastAPI `/chat` access.

When `REQUIRE_AUTH` is false, unauthenticated callers can provide arbitrary `userId` values. The code uses verified Firebase claims when present, but without required auth there is no cryptographic identity to bind the request to a stable user.

**Recommendation:** Set `REQUIRE_AUTH=true` in every internet-facing production deployment and restrict direct access to the agent service so only the web service can call it. The client already obtains Firebase tokens for chat calls.

### Medium: User-Meta Counter Increment Is Read-Modify-Write

**Status:** Not fixed in this change.  
**Risk:** Concurrent requests can race and undercount usage.  
**Affected area:** `UserMetaStore.increment_turn_count`.

The counter reads the document, increments locally, then writes it back. Concurrent requests for the same UID can undercount, allowing some extra usage around the hard cap.

**Recommendation:** Replace with a Firestore transaction or atomic increment and reject if the resulting counter exceeds the threshold.

### Medium: No Dedicated Per-IP / Per-Token Burst Rate Limiter

**Status:** Not fixed in this change.  
**Risk:** Attackers can create many anonymous Firebase users and consume the free allowance per UID.  
**Affected area:** Edge/API gateway layer.

Hard per-user caps stop unbounded usage for a single identity, but attackers can automate signup/anonymous account creation.

**Recommendation:** Add an API gateway, Cloud Armor, Redis, or Firestore-backed sliding-window limiter keyed by IP, UID, and Firebase token `auth_time`. Consider device attestation or CAPTCHA for anonymous onboarding.

### Medium: Web Proxy Previously Masked 429 as 502

**Status:** Fixed in this change.  
**Risk:** Quota enforcement worked at the agent but would appear as a generic upstream failure in the web app.

The web proxy now preserves upstream `429` and `Retry-After`, allowing clients and monitoring to distinguish quota limits from infrastructure failures.

### Low: Workspace OAuth Token Handling

**Status:** Acceptable in reviewed endpoints.  
**Risk:** Token disclosure was not observed in API responses.

The workspace OAuth exchange persists token material server-side and returns connection metadata only. Tests assert that refresh tokens are not echoed back.

## Pen Test Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Anonymous caller reaches hard limit | Blocked with HTTP 429 | New FastAPI test verifies no runner calls after count 20 |
| Signed-in free caller reaches hard limit | Blocked with HTTP 429 | New FastAPI test verifies no runner calls after count 100 |
| Authenticated body UID spoofing | Protected | Existing test verifies token UID overrides body UID |
| Web proxy receives quota denial | Preserved as 429 | New Next.js API route test covers `Retry-After` |
| Workspace refresh token echo | Not observed | Existing OAuth exchange test verifies persistence without echo |

## Recommendations Before Production

1. **Set `REQUIRE_AUTH=true` in production** and block public direct access to the agent service.
2. **Use transactional usage counters** to prevent concurrency undercounting.
3. **Add burst rate limits** by UID and IP before `/api/chat` and direct `/chat`.
4. **Add billing alerts** for Vertex/Gemini spend and request volume anomalies.
5. **Log quota-denied events** with UID, auth state, tier, and request metadata for abuse monitoring.
6. **Consider App Check / reCAPTCHA Enterprise** for anonymous sessions.
7. **Move hard limits to configuration** once the product team decides exact free-tier allowances.

## Conclusion

The codebase now has a server-side LLM cutoff that directly addresses the main billing-abuse concern: a caller cannot keep using the same free account to get unlimited LLM turns. Remaining risk comes primarily from deployment configuration, counter race conditions, and large-scale creation of many free identities.
