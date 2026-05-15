# ADR 0001: Background and Scheduled Agent Runs

- **Status:** Proposed
- **Date:** 2026-05-14
- **Authors:** Lifecoach maintainers
- **Related areas:** `apps/agent_py`, Google Workspace tools, Firestore storage, Terraform infra

## Context

Lifecoach currently works as a foreground chat product: the browser sends a message, `apps/web` proxies it to `apps/agent_py`, and the agent streams a response over SSE. The agent already has Google Workspace capabilities for signed-in users who have granted Workspace scopes, including inbox triage, workspace search, archiving messages, calendar events, and tasks.

We want the agent to work without an active browser session so it can do jobs such as:

- automatically triage a user's inbox every weekday morning;
- create a digest of urgent emails, upcoming calendar conflicts, and open tasks;
- prepare suggested follow-up tasks or calendar blocks;
- notify the user inside Lifecoach when a background run has something worth reviewing.

This changes the execution model. A scheduled run cannot rely on browser-held Firebase ID tokens, SSE delivery, geolocation, or a user sitting in front of a confirmation prompt. It also creates cost, consent, privacy, retry, and idempotency requirements that are stricter than ordinary chat turns.

## Decision

Build background work as **server-owned scheduled runs** in the Python agent service, triggered by Google Cloud scheduling primitives and persisted in Firestore. Do not run schedules from the browser and do not add a separate orchestration product in the first iteration.

The initial implementation should use this shape:

```mermaid
flowchart LR
    CS[Cloud Scheduler] -->|OIDC service identity| SWEEP[POST /background/schedules/run]
    SWEEP --> FS[(Firestore schedules + runs)]
    SWEEP --> CT[Cloud Tasks queue]
    CT -->|OIDC service identity| EXEC[POST /background/runs/{runId}/execute]
    EXEC --> AG[Background agent runner]
    AG --> GWS[Google Workspace APIs]
    AG --> FS
    AG --> OUT[notification + chat digest]
```

### Runtime model

1. **Schedules are durable user intent.** Store each user-configured automation as a Firestore schedule document with the user ID, schedule type, timezone, cadence, enabled flag, and consent/audit metadata.
2. **Cloud Scheduler only wakes the system.** It calls a sweep endpoint on a fixed cadence, for example every 5 minutes. The sweep finds due schedules; per-user schedule calculations remain in app code so user timezones and product rules can evolve without changing Cloud Scheduler jobs.
3. **Cloud Tasks executes individual runs.** The sweep creates one run document per due schedule and enqueues one HTTP task per run. Cloud Tasks gives bounded retries, dispatch-rate controls, deduplication by task name, and isolation so one slow inbox does not block other users.
4. **The executor runs a background-safe agent path.** It reuses the existing agent dependencies and Workspace tool implementations where possible, but runs with `run_mode="background"` so prompts, tools, logging, and safety rules can differ from interactive chat.
5. **Background output is a digest, not an invisible action.** The first shipped automation should be read-only inbox triage. It may write a digest/notification and proposed actions, but it must not archive email, create calendar events, add tasks, or complete tasks unless the user later approves those actions in a foreground chat turn.
6. **Tokens stay server-side.** The executor loads Workspace OAuth tokens through the existing token store. Tokens are never written into prompts, task payloads, notifications, or client-visible documents.
7. **The chat UI remains the review surface.** Background results should appear as a notification, digest card, or synthetic assistant message that invites the user to review and approve next actions.

## Non-goals

- General-purpose cron for arbitrary user instructions.
- A fully autonomous email/calendar assistant that performs destructive writes without confirmation.
- A new long-running worker platform, Temporal cluster, or separate microservice before the simple Cloud Scheduler + Cloud Tasks approach proves insufficient.
- Browser-based polling or client-side timers.
- Gmail push notifications as the first trigger mechanism. They can be added later for near-real-time use cases, but scheduled triage is enough for the initial product.

## Data model

Exact names can change during implementation, but the model should keep schedules, execution attempts, and user-visible output separate.

### `backgroundSchedules/{scheduleId}`

Suggested fields:

| Field | Purpose |
|---|---|
| `uid` | Owner user ID. |
| `kind` | Automation type, initially `email_triage_digest`. |
| `enabled` | User-controlled on/off switch. |
| `timezone` | IANA timezone for local-time schedules. |
| `cadence` | Structured cadence such as `{type:"daily", localTime:"08:00", weekdays:[1,2,3,4,5]}`. |
| `nextRunAt` | Absolute UTC timestamp used by the sweep query. |
| `lastRunAt` | Last attempted run. |
| `consentVersion` | Version of the consent copy the user accepted. |
| `createdAt`, `updatedAt` | Audit timestamps. |

### `backgroundRuns/{runId}`

Suggested fields:

| Field | Purpose |
|---|---|
| `uid`, `scheduleId`, `kind` | Run identity and owner. |
| `status` | `queued`, `running`, `succeeded`, `failed`, `skipped`, or `cancelled`. |
| `idempotencyKey` | Stable key, for example `{scheduleId}:{scheduledFor}`. |
| `scheduledFor`, `startedAt`, `finishedAt` | Timing and latency analysis. |
| `attempt` | Cloud Tasks attempt count mirrored for debugging. |
| `leaseExpiresAt` | Executor lease to avoid duplicate active work. |
| `summaryRef` | Pointer to user-visible output. |
| `errorCode`, `errorMessage` | Sanitized failure data; no tokens or email bodies. |

### `backgroundNotifications/{notificationId}`

Suggested fields:

| Field | Purpose |
|---|---|
| `uid`, `runId`, `kind` | Owner and source. |
| `status` | `unread`, `read`, `dismissed`, or `acted_on`. |
| `title`, `summary` | Client-safe digest text. |
| `items` | Structured triage rows with stable Workspace IDs and short snippets. |
| `proposedActions` | Actions requiring foreground confirmation. |
| `createdAt` | Sort key for the UI. |

If background results are also added to the chat timeline, write them as explicit background-authored events or a separate session namespace such as `background:{scheduleId}`. Avoid making them indistinguishable from user-triggered assistant turns.

## API surface

Add service-to-service endpoints on `apps/agent_py`; do not proxy these through `apps/web`.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /background/schedules/run` | Cloud Scheduler OIDC / IAM | Sweep due schedules and enqueue run tasks. |
| `POST /background/runs/{runId}/execute` | Cloud Tasks OIDC / IAM | Execute one idempotent background run. |
| `GET /background/notifications` | Firebase bearer | List the current user's digest cards. |
| `PATCH /background/notifications/{id}` | Firebase bearer | Mark digest read/dismissed/acted-on. |
| `POST /background/schedules` | Firebase bearer | Create or update a user-owned schedule from the UI or chat tool. |
| `DELETE /background/schedules/{id}` | Firebase bearer | Disable a schedule. Prefer soft-disable over hard delete for auditability. |

The service-to-service endpoints should reject browser Firebase tokens. User-facing endpoints should continue to use Firebase bearer auth.

## Agent design

Background execution should not simply POST a hidden message to `/chat`.

Instead, create a small background runner that shares infrastructure with chat but makes the non-interactive mode explicit:

- build a `BackgroundRunContext` from the schedule, user profile, Workspace status, and safe context providers;
- use a separate prompt section that tells the model it is running without the user present;
- expose only background-safe tools, initially read-only `triage_inbox`/lookup tools and a `write_background_digest` tool;
- disable UI-directive tools such as `ask_single_choice_question`, `auth_user`, `connect_workspace`, and `upgrade_to_pro`;
- disable destructive Workspace writes in background mode until a foreground confirmation flow consumes a proposed action;
- cap model/tool steps, Gmail page sizes, message-body bytes, and wall-clock runtime per run.

The executor should skip the run, not fail permanently, when:

- the Workspace token is missing, expired beyond refresh, revoked, or lacks required scopes;
- the user disabled the schedule after the task was queued;
- another run for the same schedule/idempotency key already succeeded;
- the user is over a product-defined automation quota.

## Safety, consent, and privacy rules

1. **Explicit opt-in:** no background schedule is created implicitly by connecting Workspace. The user must ask for or toggle a schedule.
2. **Clear scope:** schedule copy should say what will be read, how often, where the digest appears, and whether any external notification is sent.
3. **No silent destructive writes:** archive, send, create, modify, or complete actions require foreground user approval unless a future ADR explicitly approves narrower autonomous actions.
4. **Least payload:** Cloud Tasks payloads contain `runId` only. The executor loads details server-side from Firestore.
5. **No sensitive logs:** logs may include IDs, counts, statuses, and error classes; never log OAuth tokens, email bodies, or full snippets.
6. **User controls:** users can pause/delete schedules and disconnect Workspace. Disconnecting Workspace disables or skips future runs.
7. **Cost guardrails:** define per-tier maximum schedules, runs per day, messages inspected per run, and model/tool budget.
8. **Idempotency:** every run has a deterministic idempotency key and executor lease. Retries must not duplicate notifications or proposed actions.

## Infrastructure

Add Terraform-managed resources only:

- a Cloud Scheduler job per environment that calls `/background/schedules/run`;
- a Cloud Tasks queue for background run execution;
- IAM bindings allowing the Scheduler and Tasks service accounts to invoke the agent Cloud Run service;
- environment variables for queue name, project, region, max run duration, and feature flags;
- Firestore indexes for due schedule queries, for example `enabled + nextRunAt` and `uid + createdAt` notification listing.

Keep the first version inside the existing `lifecoach-agent` Cloud Run service. Split to a separate `lifecoach-background-worker` service only if we need different scaling, CPU/memory, concurrency, or deploy cadence.

## Observability and operations

Emit structured logs and metrics for:

- schedule sweep counts: due, enqueued, skipped, failed;
- run lifecycle: queued, lease acquired, started, succeeded, skipped, failed;
- Workspace calls: service/resource/method, count, latency, classified error;
- model calls: model, token estimate, latency, finish reason;
- notification writes and foreground action conversions.

Add alerts for:

- repeated sweep failure;
- Cloud Tasks queue age above the intended freshness window;
- run failure rate above threshold;
- unexpectedly high model/tool cost;
- repeated token revocations or `scope_required` errors.

## Alternatives considered

### Browser timers or service workers

Rejected. They require an active browser/device, cannot be trusted for durable scheduling, and would push background product logic into the client.

### Cloud Scheduler directly calls an execution endpoint per schedule

Rejected for the product scale we expect. Managing one Cloud Scheduler job per user schedule is operationally awkward, has quota implications, and makes schedule changes infrastructure-like instead of app data.

### Cloud Scheduler + Pub/Sub push

Viable, but Cloud Tasks is a better fit for one HTTP task per user run because it provides task names for deduplication, per-queue dispatch controls, and retry semantics that map directly to idempotent jobs.

### Cloud Run Jobs

Useful for batch sweeps, but less ergonomic for many small per-user jobs and user-level retries. We can revisit if runs become heavy batch work.

### Workflows or Temporal

Powerful, but too much orchestration surface for the first version. Reconsider if background jobs become multi-step, long-lived workflows with human approval checkpoints and complex compensation.

### Gmail push notifications

Useful later for near-real-time triage, but it adds Pub/Sub topic management, watch renewal, mailbox history cursors, and different failure modes. Scheduled digests should ship first.

## Consequences

### Positive

- Durable schedules work when the user is offline.
- The design keeps Workspace OAuth tokens server-side and outside task payloads.
- Cloud Tasks isolates retries and lets us throttle cost and API usage.
- The existing agent service and Workspace tooling can be reused without prematurely creating a new service.
- Background output is reviewable and auditable instead of invisible.

### Negative / trade-offs

- Adds new Firestore collections, indexes, IAM, and queue operations.
- Requires a second execution path beside foreground `/chat`.
- Background prompt/tool behavior must be tested separately from chat behavior.
- Notification UX and digest storage introduce new product surfaces.

## Rollout plan

1. **ADR review:** confirm the run model, data model, safety rules, and first automation scope.
2. **Read-only MVP:** implement `email_triage_digest` with manual admin-triggered execution in a non-production environment.
3. **Scheduler MVP:** add Cloud Scheduler + Cloud Tasks, but keep the feature behind an environment flag and allowlist.
4. **User opt-in UI:** add schedule creation/disable controls and notification listing.
5. **Foreground approval loop:** let users approve proposed archive/task/calendar actions in chat using the existing Workspace write tools.
6. **Quotas and billing:** enforce per-tier limits before widening beyond an allowlist.
7. **Production hardening:** alerts, dashboards, runbook, and data retention policy.

## Testing requirements

- Unit tests for schedule due-time calculation across timezones and daylight-saving changes.
- Storage tests for schedule/run/notification repositories with Firestore fakes.
- Endpoint tests for IAM-only background routes and Firebase-only user routes.
- Idempotency tests proving Cloud Tasks retries do not duplicate notifications.
- Workspace fake tests for missing scopes, revoked tokens, rate limits, and empty inboxes.
- Prompt/eval tests for background mode that assert no foreground-only UI tools or destructive tools are used.
- Integration smoke test for sweep -> task -> executor -> notification with all external APIs faked.

## Open questions

- Should background digests appear in the main chat history, a notification drawer, or both?
- What is the default retention period for background run details and email snippets?
- Which tiers get scheduled automations, and what are their daily/monthly run caps?
- Do we need external notifications such as email or push, or is in-app review enough for the first release?
- How should users edit cadence from chat while preserving explicit consent copy?
