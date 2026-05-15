# ADR 0001: Background and scheduled agent work

- **Status:** Proposed
- **Date:** 2026-05-15
- **Decision makers:** Lifecoach maintainers
- **Related areas:** `apps/agent_py`, Google Workspace integration, Firestore storage, Terraform infrastructure, web digest UI
- **Synthesizes:** PRs #120, #121, #122, and #123, including review feedback about Cloud Tasks failure handling and task ID validity.

## Context

Lifecoach currently runs the coaching agent in response to foreground chat turns. The browser sends a chat request through `apps/web`, the Python FastAPI service in `apps/agent_py` verifies the Firebase bearer token, assembles context, invokes the ADK runner, executes tools, persists state, and streams the result back over SSE.

Google Workspace is connected through OAuth, with per-user tokens stored server-side and used by agent-owned Workspace tools for Gmail, Calendar, and Tasks. OAuth tokens must never be included in prompts, task payloads, logs, browser responses, or model-visible tool arguments.

We want the agent to do useful work when the user is not actively chatting, starting with scheduled Workspace routines such as:

- daily or weekday morning Gmail triage;
- urgent-email scans;
- digests of actionable emails, upcoming calendar conflicts, and open tasks;
- preparation before a daily planning session;
- later event-triggered work such as Gmail push notifications.

Background work changes the execution model. A scheduled run cannot rely on browser-held Firebase ID tokens, SSE delivery, geolocation, or a user sitting in front of an approval prompt. It also creates stricter requirements for opt-in consent, idempotency, retries, rate limits, observability, privacy, retention, and cost controls.

## Decision

Build a **server-owned background work subsystem** in the existing Python agent Cloud Run service, triggered by managed Google Cloud scheduling and queueing primitives and persisted in Firestore.

The initial implementation will use one Terraform-managed Cloud Scheduler job per environment as a coarse wake-up trigger, one Terraform-managed Cloud Tasks queue for per-run execution, and explicit background endpoints in `apps/agent_py`. The MVP workflow is read-only scheduled inbox triage that writes Lifecoach-owned run records, proposed actions, and reviewable digest artifacts. It must not archive email, send email, create calendar events, create tasks, or otherwise mutate third-party systems until the user confirms the exact action in a foreground flow.

```mermaid
flowchart LR
  CS[Cloud Scheduler\ncoarse environment tick] -->|OIDC service identity| DISPATCH[agent_py\nPOST /background/scheduler/tick]
  DISPATCH --> FS[(Firestore\nautomations + leases + runs)]
  DISPATCH --> CT[Cloud Tasks queue\nbackground-agent-runs]
  CT -->|OIDC service identity| RUN[agent_py\nPOST /background/runs/{runId}/execute]
  RUN --> TOK[(Firestore\nWorkspace tokens)]
  RUN --> GWS[Google Workspace APIs]
  RUN --> BG[Background workflow runner]
  BG --> LLM[ADK sub-agent / deterministic classifier]
  RUN --> OUT[(Firestore\nbackgroundRuns + notifications + proposedActions)]
  OUT --> UI[Web / chat review UI]
```

## Runtime model

### 1. Store durable user automation preferences in Firestore

Each user-configured automation is application state, not model state. Exact collection names can change during implementation, but the schema should keep schedules, execution attempts, and user-visible output separate.

A suggested schedule document shape is:

```text
backgroundSchedules/{scheduleId}
  uid: string
  kind: "email_triage_daily" | "email_urgent_scan" | future workflow kind
  enabled: boolean
  timezone: IANA timezone
  cadence: structured policy, e.g. {type:"daily", localTime:"08:00", weekdays:[1,2,3,4,5]}
  lookbackWindow: "12h" | "1d" | "3d"
  consentVersion: string
  permittedActions:
    archiveNoise: "never" | "after_confirmation" | "auto_if_rule_matches"
    createTasks: "never" | "after_confirmation" | "auto_if_rule_matches"
    createCalendarEvents: "never" | "after_confirmation" | "auto_if_rule_matches"
  notify:
    inApp: boolean
    email: boolean
    chatSummaryOnNextOpen: boolean
  nextRunAt: timestamp
  lastRunAt?: timestamp
  lastStatus?: "ok" | "skipped" | "failed"
  createdAt: timestamp
  updatedAt: timestamp
```

The first release should support only `email_triage_daily` and treat every third-party write as `after_confirmation` at most. Future automatic actions require a separate ADR or explicit follow-up decision that defines consent text, audit logs, per-action limits, reversibility, and recovery UX.

### 2. Use Cloud Scheduler only as a coarse coordinator trigger

Add a service-to-service endpoint in `apps/agent_py` such as:

```http
POST /background/scheduler/tick
```

Responsibilities:

- Authenticate with Cloud Scheduler OIDC / IAM and reject browser Firebase bearer tokens.
- Query Firestore for enabled schedules with `nextRunAt <= now`.
- Acquire short Firestore leases or transactionally claim due schedules so overlapping ticks do not fan out duplicate runs.
- Create a `backgroundRuns/{runId}` record before external calls.
- Enqueue one Cloud Task per due run.
- Advance `nextRunAt` only after enqueue succeeds, or keep a lease/retry marker that makes recovery deterministic.
- Avoid LLM, Gmail, Calendar, or Tasks work directly; this endpoint only fans out durable per-user tasks.

This avoids one Cloud Scheduler job per user, keeps user timezones and schedule policy in application code, and prevents one slow mailbox from blocking dispatch for other users.

### 3. Use Cloud Tasks for per-run execution, but own terminal failure state in the app

Add a Terraform-managed Cloud Tasks queue with bounded dispatch rate, bounded concurrency, and a retry policy. Add a worker endpoint in `apps/agent_py` such as:

```http
POST /background/runs/{runId}/execute
```

Task payloads should contain only identifiers needed to load server-side state:

```json
{
  "runId": "run_20260515_080000Z_3ff1a2",
  "scheduleId": "sched_abc123",
  "uid": "firebase uid",
  "kind": "email_triage_daily",
  "scheduledFor": "2026-05-15T08:00:00Z"
}
```

Requirements:

- Authenticate the caller as Cloud Tasks using OIDC / IAM.
- Load the schedule, user state, profile, billing/usage policy, and Workspace token state server-side.
- Validate opt-in, Workspace connection, required scopes, consent version, product tier, and per-user automation quota before touching Gmail or the LLM.
- Use Cloud Tasks for retry/backoff and dispatch throttling, but **do not rely on Cloud Tasks as a dead-letter queue**. HTTP tasks that exhaust retry limits can be deleted by Cloud Tasks, so the worker must persist every terminal state itself.
- Record `terminal_failed` or `skipped` in `backgroundRuns` for revoked tokens, missing scopes, disabled schedules, invalid consent, ineligible users, or exhausted attempts that the app observes.
- Optionally publish app-owned terminal failures to a separate queue/topic later if operational needs require it.

Cloud Tasks is at-least-once, not exactly-once. The application must own idempotency, leases, and duplicate suppression.

### 4. Make deterministic task IDs valid and collision-resistant

Use a deterministic Cloud Tasks task ID as the first dedupe layer and a Firestore claim as the second dedupe layer. The task ID must be sanitized because Cloud Tasks task IDs allow only letters, numbers, hyphens, and underscores.

Do **not** use raw ISO timestamps such as `2026-05-15T08:00:00Z` in the task ID because the colon characters are invalid. Prefer one of these shapes:

```text
background-{safeKind}-{uidHash}-{YYYYMMDDTHHMMSSZ}-{shortHash}
background-email_triage_daily-a1b2c3d4-20260515T080000Z-7f9e2a
```

Guidelines:

- Encode the scheduled timestamp as `YYYYMMDDTHHMMSSZ`.
- Hash the `uid` and any long or sensitive identifiers before including them in the task ID.
- Replace any non-`[A-Za-z0-9_-]` character in workflow names or IDs with `_`.
- Keep a full idempotency key such as `{scheduleId}:{kind}:{scheduledFor}` in Firestore for auditability even if the public task ID is hashed or shortened.

### 5. Execute workflows through a background-safe agent path

Background execution should not post a hidden synthetic message to `/chat`. Create an explicit background runner that shares infrastructure with chat but makes non-interactive semantics visible in code:

```python
class BackgroundWorkflow(Protocol):
    name: str

    async def run(self, ctx: BackgroundRunContext) -> BackgroundRunResult:
        ...
```

The runner should:

- build a `BackgroundRunContext` from the schedule, user profile, Workspace status, usage policy, safe context providers, and run record;
- reuse the existing Workspace token store and Workspace projection boundary so OAuth tokens stay server-side;
- expose only background-safe tools, initially read-only inbox triage / lookup tools and a digest-writing tool;
- disable UI-directive tools such as `ask_single_choice_question`, `auth_user`, `connect_workspace`, and `upgrade_to_pro`;
- disable destructive Workspace writes in background mode until foreground approval consumes a proposed action;
- cap model/tool steps, Gmail page sizes, message-body bytes, and wall-clock runtime;
- produce validated structured output rather than free-form hidden chat turns.

### 6. Persist reviewable artifacts and proposed actions

Every run should create a queryable run record and any user-visible output as separate records.

Suggested run record:

```text
backgroundRuns/{runId}
  uid: string
  scheduleId: string
  kind: string
  status: "queued" | "running" | "succeeded" | "retryable_failed" | "terminal_failed" | "skipped" | "cancelled" | "superseded"
  idempotencyKey: string
  scheduledFor: timestamp
  inputWindowStart: timestamp
  inputWindowEnd: timestamp
  startedAt?: timestamp
  finishedAt?: timestamp
  attempt: number
  leaseExpiresAt?: timestamp
  outputRef?: string
  errorCode?: string
  errorMessage?: sanitized string
  model?: string
  tokenCostEstimate?: number
```

Suggested notification or digest record:

```text
backgroundNotifications/{notificationId}
  uid: string
  runId: string
  kind: "email_triage_daily"
  status: "unread" | "read" | "dismissed" | "acted_on"
  title: string
  summary: client-safe digest text
  items: structured triage rows with stable Workspace IDs and short snippets
  proposedActions: action IDs requiring foreground confirmation
  createdAt: timestamp
  expiresAt?: timestamp
```

Suggested action records should be individually addressable and auditable, for example `archive_message`, `create_task`, or `create_calendar_event`, each with source message IDs, current approval status, and execution result. If background results are also shown in chat history, write them as explicit background-authored events or a separate `background:{scheduleId}` session namespace so they cannot be confused with user-triggered assistant turns.

## Scheduled inbox triage MVP

The first workflow is `email_triage_daily`:

1. Verify the schedule is still enabled and the user is eligible.
2. Verify Workspace is connected and required scopes are available.
3. Select a bounded Gmail query/window from `lastSucceededAt` or the scheduled input window.
4. Fetch projected message headers/snippets/bodies through existing Gmail projection code; avoid persisting full bodies unless a UX need and retention policy require it.
5. Classify messages into buckets such as `noise`, `actions`, `events`, and `info` using the existing triage schema or sub-agent.
6. Persist a digest, source message IDs, and proposed actions.
7. Notify the user only according to preferences, initially in-app or on next chat open.
8. Require foreground confirmation before any Gmail, Calendar, or Tasks write executes.

The executor should return a 2xx response for completed runs and permanent skips so Cloud Tasks does not retry non-retryable conditions. It should return retryable 5xx responses only for transient infrastructure, Firestore, Gmail, Vertex, or network failures within bounded attempts.

## Security, privacy, and safety requirements

- Background workflows are explicit opt-in per user and per workflow; connecting Workspace must not create schedules implicitly.
- Consent copy must state what will be read, how often, where the digest appears, which notifications may be sent, and what actions still require confirmation.
- Internal scheduler and task endpoints require Cloud Scheduler / Cloud Tasks OIDC identities and reject browser Firebase tokens.
- User-facing schedule and notification endpoints continue to use Firebase bearer auth.
- Task payloads contain identifiers only; OAuth tokens and raw email data are loaded server-side.
- OAuth tokens are never sent to the LLM, task payloads, logs, notifications, or client-visible documents.
- Logs may include IDs, counts, status, latency, and sanitized error classes; never log OAuth tokens, raw email bodies, or full snippets.
- Disconnecting Workspace disables or skips future Workspace-dependent runs before any Workspace read.
- Users can pause schedules, disable schedules, dismiss/delete pending artifacts, and disconnect Workspace.
- Background LLM usage must respect product-defined per-tier quotas and model/tool budgets.
- The digest UI must clearly distinguish model-generated classifications and proposals from completed actions.

## API surface

Exact paths can change during implementation, but separate service-to-service routes from user-facing routes:

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /background/scheduler/tick` | Cloud Scheduler OIDC / IAM | Sweep due schedules and enqueue run tasks. |
| `POST /background/runs/{runId}/execute` | Cloud Tasks OIDC / IAM | Execute one idempotent background run. |
| `GET /background/notifications` | Firebase bearer | List current user's digest cards. |
| `PATCH /background/notifications/{id}` | Firebase bearer | Mark digest read, dismissed, or acted on. |
| `POST /background/schedules` | Firebase bearer | Create or update a user-owned schedule from UI or chat. |
| `DELETE /background/schedules/{id}` | Firebase bearer | Soft-disable a user-owned schedule for auditability. |

Do not proxy service-to-service scheduler/task endpoints through `apps/web`.

## Infrastructure

All production infrastructure changes must be represented in Terraform:

- Enable Cloud Scheduler API.
- Enable Cloud Tasks API.
- Create one Cloud Scheduler job per environment that calls the scheduler tick endpoint every 5-15 minutes.
- Create one Cloud Tasks queue per environment with rate limits, retry policy, and concurrency limits aligned to Gmail API and model budget.
- Grant the scheduler service account permission to invoke the scheduler tick endpoint.
- Grant the Cloud Tasks service account permission to invoke the run endpoint.
- Add IAM bindings, service accounts, environment variables, queue names, project/region settings, and OIDC audience configuration.
- Add Firestore indexes for due schedule queries, run lookup, and notification listing, for example `enabled + nextRunAt` and `uid + createdAt`.

Keep the first version inside the existing agent Cloud Run service. Split to a dedicated `lifecoach-background-worker` service only if foreground latency, scaling, CPU/memory requirements, or deployment cadence justify the extra operational surface.

## Observability and operations

Emit structured logs and metrics for:

- scheduler ticks: due schedules, enqueued tasks, skipped schedules, failed enqueues;
- leases and idempotency decisions;
- run lifecycle: queued, running, succeeded, skipped, retryable failed, terminal failed, cancelled, superseded;
- Cloud Tasks attempt number and queue age;
- Workspace calls by service/resource/method, count, latency, and classified error;
- model calls by model, token estimate, cost estimate, latency, and finish reason;
- notification writes and foreground action conversions.

Add alerts for repeated scheduler failure, queue age above the freshness target, high run failure rate, unexpectedly high model/tool cost, repeated token revocations, and repeated missing-scope errors. Add an admin/debug script or endpoint to inspect a user's last background run without exposing OAuth tokens.

## Testing requirements

- Unit-test schedule due-time calculation across timezones and daylight-saving changes.
- Unit-test deterministic sanitized task ID generation.
- Storage-test schedule, run, lease, idempotency, notification, and proposed-action repositories with Firestore fakes.
- Endpoint-test IAM-only background routes and Firebase-only user routes.
- Replay-test duplicate Cloud Task deliveries to prove the same run does not duplicate digests or actions.
- Workspace-fake tests for missing scopes, revoked tokens, rate limits, empty inboxes, and disconnected users.
- Prompt/eval tests for background mode that assert foreground-only UI tools and destructive tools are unavailable.
- Integration smoke-test the sweep -> task -> executor -> notification path with all external APIs faked.

## Alternatives considered

### Browser timers or service workers

Rejected. They require an active user device/browser session, cannot provide durable scheduling, and would push background product logic into the client.

### Long-running worker loop inside Cloud Run

Rejected for the first iteration. Cloud Run instances can scale to zero, a sleeping loop couples scheduler availability to container lifecycle, and ad hoc loops make deployments, retries, and per-user rate limits harder.

### Cloud Scheduler directly executes every due user run

Rejected. Inline fan-out makes retries coarse, risks request timeouts, and lets one user's slow mailbox block other due work. One Cloud Scheduler job per user also turns user schedule changes into infrastructure changes and conflicts with Terraform ownership.

### Pub/Sub as the primary per-user execution queue

Deferred. Pub/Sub is viable for broad event fan-out and later Gmail push notifications, but Cloud Tasks maps better to authenticated HTTP handlers, deterministic task names, dispatch-rate controls, and per-run retry policy.

### Cloud Run Jobs

Deferred. Cloud Run Jobs may be useful for batch maintenance or backfills, but they are less ergonomic for many small per-user HTTP-style runs and user-level retries.

### Workflows or Temporal

Deferred. They are powerful for multi-step long-lived workflows, human approval checkpoints, and compensation, but too much orchestration surface for a read-only triage MVP.

### Full conversational root agent on a synthetic chat prompt

Rejected. A fake message such as "triage my inbox now" mixes interactive and autonomous semantics, complicates SSE/session history, and blurs policy/audit boundaries. A dedicated background workflow can still reuse triage sub-agents and tools while producing deterministic run records.

### Next.js web app owns background work

Rejected. Workspace tokens and agent orchestration live in `apps/agent_py`; moving automation into the web app would blur auth-plane boundaries and duplicate storage/tooling.

## Consequences

### Positive

- The agent can do useful work without an active browser session.
- Scheduling policy stays in application data instead of per-user cloud infrastructure.
- The design reuses the existing Python agent, Workspace OAuth storage, projections, and triage behavior.
- Foreground chat remains isolated from slow or retrying background work.
- Runs, digests, and proposed actions are reviewable and auditable.
- The system can grow from scheduled digests to event-triggered workflows using the same execution model.

### Negative / trade-offs

- Adds operational complexity: Scheduler, Tasks, IAM/OIDC, queue configuration, Firestore indexes, leases, and run-state storage.
- Requires a second execution path beside foreground `/chat`.
- Background prompt/tool behavior needs its own evals and safety tests.
- Background LLM calls create cost when users are not actively chatting.
- OAuth refresh failures and revoked Workspace permissions become asynchronous user-facing states.
- Digest UI, schedule settings, retention, and approval UX become required product surfaces before broad rollout.

## Rollout plan

1. Confirm this ADR and close PRs #120, #121, #122, and #123 in favor of the synthesized decision.
2. Define shared contract types for schedules, run records, notifications, proposed actions, and sanitized task IDs.
3. Add Firestore storage adapters and unit tests for due queries, leases, run claiming, idempotency, and terminal failure persistence.
4. Add service-to-service endpoint skeletons for scheduler tick and run execution behind OIDC/IAM, initially with a no-op workflow.
5. Add Terraform for Scheduler, Tasks, IAM, environment variables, and Firestore indexes.
6. Implement read-only `email_triage_daily` for an internal allowlist with all external APIs faked in tests.
7. Add the opt-in settings UI and pending digest review UI.
8. Add foreground approval flows for proposed archive/task/calendar actions using existing Workspace write tools.
9. Enforce per-tier quotas and cost monitoring before widening beyond the allowlist.
10. Evaluate Gmail push notifications and limited automatic rules only after scheduled triage has reliable observability and user value.

## Open questions

- Should background automation usage count against the existing chat quota, a separate automation quota, or Pro-only limits?
- What retention period applies to run records, projected snippets, digests, and proposed actions?
- Which notification channels should v1 support: in-app only, email summary, push, or next-chat summary?
- What is the minimum digest UI needed before enabling scheduled triage for real users?
- Should background digests appear in main chat history, a notification drawer, or both?
- Do we need separate Workspace consent copy for background Gmail processing beyond current Workspace connection copy?
- Should the triage sub-agent use the same model as interactive Workspace calls or a cheaper scheduled-work model?
- How should users pause automations during vacations or outside working days?
