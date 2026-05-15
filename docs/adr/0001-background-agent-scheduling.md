# ADR 0001: Background and Scheduled Agent Workflows

- Status: Proposed
- Date: 2026-05-14
- Owners: Lifecoach engineering
- Related areas: `apps/agent_py`, Google Workspace integration, Terraform-managed infrastructure

## Context

Lifecoach currently runs the coaching agent in response to foreground HTTP chat turns. The browser sends a chat request through `apps/web`, the Python FastAPI service in `apps/agent_py` verifies the Firebase bearer token, assembles context, invokes the ADK runner, executes tools, persists state, and streams the result back over SSE. Google Workspace is connected through OAuth, with per-user tokens stored server-side in Firestore and used by workspace tools for Gmail, Calendar, and Tasks.

We want the agent to do useful work when the user is not actively chatting, for example:

- triage Gmail on a weekday morning;
- prepare a digest before a daily planning session;
- notice new actionable messages and propose tasks;
- summarize calendar changes before the next day;
- run periodic goal or habit check-ins.

This introduces new requirements that foreground chat does not have:

- a scheduler must trigger work reliably without a browser tab being open;
- work must be scoped to users who explicitly opted in and have valid Workspace consent;
- retries must be safe, idempotent, observable, and rate-limited;
- email/calendar actions must respect privacy and avoid destructive side effects without user confirmation;
- infrastructure must be represented in Terraform, consistent with the repo invariant that production infrastructure is not changed manually;
- the LLM must not see OAuth tokens or billing/auth internals; it should receive only projected data and task instructions.

## Decision

Adopt a Cloud Run + Cloud Scheduler + Cloud Tasks architecture for background agent workflows, implemented initially inside the existing `apps/agent_py` service.

### Shape

```mermaid
flowchart LR
    CS[Cloud Scheduler\nevery minute] -->|OIDC| SCAN[agent_py\nPOST /background/scheduler/tick]
    SCAN --> FS[(Firestore\nbackgroundAutomations + leases)]
    SCAN --> CT[Cloud Tasks queue\nbackground-agent-runs]
    CT -->|OIDC task| RUN[agent_py\nPOST /background/runs/{runId}]
    RUN --> TOK[(Firestore\nworkspaceTokens/{uid})]
    RUN --> GWS[Google Workspace APIs]
    RUN --> LLM[ADK sub-agent / deterministic planner]
    RUN --> OUT[(Firestore\nbackgroundRuns + proposedActions)]
    OUT --> UI[Next.js UI\nInbox triage / digests]
```

### Components

1. **Automation configuration**
   - Store per-user opt-in configuration in Firestore, for example `backgroundAutomations/{uid}/automations/{automationId}`.
   - Include: `type`, `enabled`, `schedule`, `timezone`, `workspaceRequired`, `nextRunAt`, `lastRunAt`, `createdAt`, `updatedAt`, and user-controlled preferences such as Gmail query windows or excluded labels.
   - Supported initial type: `email_triage_daily`.

2. **Scheduler tick endpoint**
   - Add `POST /background/scheduler/tick` to `apps/agent_py`.
   - The endpoint is authenticated with Cloud Scheduler OIDC and is not browser-accessible.
   - On each tick, query due enabled automations, acquire a short Firestore lease, compute the next schedule, and enqueue one Cloud Task per due run.
   - Keep this endpoint deterministic and non-LLM: it only finds due work and enqueues tasks.

3. **Task queue and worker endpoint**
   - Add a Cloud Tasks queue with bounded concurrency and retry policy.
   - Add `POST /background/runs/{runId}` to `apps/agent_py`, authenticated with Cloud Tasks OIDC.
   - Each task includes only identifiers: `uid`, `automationId`, `runId`, and an idempotency key. It must not contain OAuth tokens or raw email data.
   - The worker loads the automation config, validates opt-in and Workspace connection, checks idempotency, runs the workflow, and writes a run record.

4. **Workflow execution**
   - Reuse the existing Workspace token store and `run_gws` boundary so OAuth tokens stay server-side.
   - For inbox triage, prefer a constrained workflow rather than a free-form chat turn:
     1. list candidate messages using a configured Gmail query/window;
     2. fetch projected message bodies/headers as needed;
     3. classify messages into `noise`, `actions`, `events`, and `info` using the existing triage model/schema;
     4. write a proposed triage report to Firestore;
     5. optionally notify the user that a report is ready.
   - The background workflow may create proposed actions, but destructive Gmail operations such as archive/delete, and external side effects such as sending email, remain gated behind explicit user approval unless a future ADR defines narrowly-scoped user-created rules.

5. **State and audit trail**
   - Store each execution in `backgroundRuns/{uid}/runs/{runId}` or a similarly queryable collection.
   - Include: `status`, `automationType`, `startedAt`, `finishedAt`, `attempt`, `idempotencyKey`, `summary`, `errorCode`, and pointers to any `proposedActions`.
   - Retain enough metadata for audit/debugging while avoiding unnecessary raw email body persistence. Persist projected snippets and classifications by default; if raw message content is needed for UX, store it with clear retention and deletion rules.

6. **User experience**
   - Add settings to opt in/out of each automation and choose schedule/timezone.
   - Surface background outputs as reviewable cards in the web app: inbox triage report, suggested tasks, proposed calendar events, and suggested archives.
   - Keep the coaching tone: the agent should explain what it found and ask for confirmation before applying write actions.

7. **Infrastructure**
   - Add Terraform-managed resources for:
     - Cloud Scheduler job;
     - Cloud Tasks queue;
     - IAM allowing Scheduler and Tasks to invoke the private background endpoints;
     - any new Firestore indexes required for querying due automations.
   - Start by hosting endpoints in the existing agent Cloud Run service. Split into a dedicated worker service only if foreground latency, resource isolation, or deployment cadence requires it.

8. **Observability and safety**
   - Emit structured logs for scheduler leases, task enqueue, run start/finish, Workspace API calls, LLM calls, retry attempts, and user-visible proposed actions.
   - Add per-user and global rate limits to prevent runaway Workspace API usage.
   - Use idempotency keys and leases so Cloud Scheduler ticks, Cloud Tasks retries, and Cloud Run restarts do not duplicate reports or actions.
   - Treat permission failures as state changes: if Workspace tokens are revoked or scopes are missing, stop scheduling Workspace-dependent automations and surface a reconnect prompt in the UI.

## Consequences

### Positive

- The agent can work without an active browser session.
- Cloud Scheduler and Cloud Tasks give managed triggering, retries, backoff, and rate limiting without running a long-lived worker.
- Background work uses the same token, tool, and projection boundaries as foreground chat, preserving the existing security model.
- The first implementation can be small: one scheduler endpoint, one worker endpoint, one queue, and one `email_triage_daily` workflow.
- The design naturally supports more workflows later, such as evening summaries, goal check-ins, calendar preparation, and task cleanup.

### Negative / trade-offs

- Adds operational complexity: queue configuration, leases, idempotency, run records, and new IAM paths.
- Background LLM calls introduce cost even when users are not actively chatting, so scheduling must respect tier limits and user preferences.
- Firestore indexes and retention policies must be designed carefully to avoid unbounded growth.
- Email triage quality depends on prompt/schema discipline and eval coverage; it should be measured before enabling broadly.

### Neutral

- Cloud Tasks is at-least-once delivery, not exactly-once. The application must own idempotency.
- Cloud Scheduler is coarse-grained; per-user local-time schedules are computed by the scheduler tick against Firestore rather than by creating one Scheduler job per user.

## Alternatives considered

1. **Browser-based timers or service workers**
   - Rejected. They require a user device/browser session and are not reliable for daily automation.

2. **A long-running worker process**
   - Rejected for now. Cloud Run request-driven workers are simpler operationally and fit current infrastructure. A dedicated worker service can be introduced later if load isolation is needed.

3. **Cloud Scheduler invoking one endpoint that performs all work inline**
   - Rejected. Inline fan-out makes retries coarse, risks request timeouts, and makes one failing user block other due work. Cloud Tasks gives per-run retries and rate limits.

4. **One Cloud Scheduler job per user automation**
   - Rejected. It creates too many infrastructure objects, makes Terraform ownership impractical, and complicates user-driven schedule changes.

5. **Gmail push notifications only**
   - Not chosen as the initial mechanism. Gmail watches are useful for near-real-time triggers, but they add watch renewal and Pub/Sub complexity. They can be added later as an event source that enqueues the same Cloud Tasks worker.

## Implementation plan

1. Define Firestore schemas for `backgroundAutomations`, `backgroundRuns`, and `proposedActions`.
2. Add a feature flag and UI settings for `email_triage_daily` opt-in.
3. Add the scheduler tick endpoint with OIDC auth, due-query logic, lease acquisition, and task enqueueing.
4. Add the Cloud Tasks worker endpoint with idempotency checks and run-record writes.
5. Extract the existing inbox triage logic into a background-callable workflow that returns a validated triage report without modifying Gmail.
6. Add Terraform for Scheduler, Tasks, IAM, environment variables, and Firestore indexes.
7. Add tests:
   - unit tests for schedule computation, lease acquisition, and idempotency;
   - unit tests for revoked/missing Workspace token behavior;
   - contract tests for run records and proposed action payloads;
   - evals for representative inbox triage cases.
8. Roll out internally, then to a small opt-in cohort, with per-user run limits and cost monitoring.

## Open questions

- Should background automations be a Pro-only feature, have a free monthly quota, or be available to all Workspace-connected users?
- What retention period should apply to triage reports and projected email snippets?
- Which notification channel should announce completed reports: in-app only, email, push, or chat recap on next visit?
- Do we need separate consent text for background Gmail processing beyond the existing Workspace connection copy?
- When, if ever, should users be allowed to create pre-approved destructive rules such as “archive newsletters every morning”?
