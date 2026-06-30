import { z } from 'zod';

/**
 * Contracts for the background / scheduled agent-work subsystem (ADR 0001).
 *
 * These shapes cross the web↔agent boundary: the Python agent owns the
 * dispatcher + executor and writes `backgroundRuns` / `backgroundNotifications`
 * / proposed-action records; the web app reads schedules + digests. Both sides
 * import the same contract — the Pydantic mirror lives in
 * `apps/agent_py/src/lifecoach_agent/contracts/background.py` and the parity
 * test (`tests/unit/test_background_contracts.py`) keeps them in lock-step.
 *
 * Timestamps are ISO-8601 strings on the wire (`z.string().datetime()`), even
 * though Firestore stores them as native Timestamps server-side — the adapter
 * converts at the storage boundary.
 *
 * OAuth tokens, raw email bodies, addresses, and full snippets must NEVER
 * appear in any of these records (ADR §Security). The schemas only carry IDs,
 * counts, status, sanitized error classes, and short client-safe text.
 */

// --- workflow kinds -------------------------------------------------------

/**
 * Workflow kinds the subsystem can schedule. The first release ships only
 * `email_triage_daily`; `email_urgent_scan` is reserved for the next
 * workflow and kept here so the enum (and the Firestore index) is stable.
 */
export const BACKGROUND_WORKFLOW_KINDS = ['email_triage_daily', 'email_urgent_scan'] as const;

export type BackgroundWorkflowKind = (typeof BACKGROUND_WORKFLOW_KINDS)[number];

// --- schedule -------------------------------------------------------------

/** How aggressive a per-action policy is allowed to be (ADR §1). The first
 * release treats every third-party write as `after_confirmation` at most;
 * `auto_if_rule_matches` is reserved for a future ADR. */
export const PERMITTED_ACTION_MODES = [
  'never',
  'after_confirmation',
  'auto_if_rule_matches',
] as const;

export type PermittedActionMode = (typeof PERMITTED_ACTION_MODES)[number];

/** Bounded Gmail lookback windows for a triage run. */
export const LOOKBACK_WINDOWS = ['12h', '1d', '3d'] as const;

export type LookbackWindow = (typeof LOOKBACK_WINDOWS)[number];

/** Last summary status surfaced on the schedule doc for the settings UI. */
export const SCHEDULE_LAST_STATUSES = ['ok', 'skipped', 'failed'] as const;

export type ScheduleLastStatus = (typeof SCHEDULE_LAST_STATUSES)[number];

/** Daily cadence policy. `localTime` is `HH:MM` 24h in the schedule's IANA
 * `timezone`; `weekdays` (0=Sunday … 6=Saturday, JS `Date.getDay()`) narrows
 * to specific days — omit for every day. An empty array is rejected: it would
 * mean "no days" (the schedule never legitimately fires), so it's an invalid
 * config rather than a silently-degraded one. */
export const ScheduleCadenceSchema = z
  .object({
    type: z.literal('daily'),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'localTime must be HH:MM 24h'),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'weekdays must be omitted or non-empty')
      .optional(),
  })
  .strict();

export type ScheduleCadence = z.infer<typeof ScheduleCadenceSchema>;

export const PermittedActionsSchema = z
  .object({
    archiveNoise: z.enum(PERMITTED_ACTION_MODES),
    createTasks: z.enum(PERMITTED_ACTION_MODES),
    createCalendarEvents: z.enum(PERMITTED_ACTION_MODES),
  })
  .strict();

export type PermittedActions = z.infer<typeof PermittedActionsSchema>;

export const NotifyPreferencesSchema = z
  .object({
    inApp: z.boolean(),
    email: z.boolean(),
    chatSummaryOnNextOpen: z.boolean(),
  })
  .strict();

export type NotifyPreferences = z.infer<typeof NotifyPreferencesSchema>;

/** True if `tz` is a resolvable IANA timezone. Rejects "PST" / "not-a-zone"
 * which would mis-compute local daily runs + DST transitions. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A user-configured automation. Application state, not model state. */
export const BackgroundScheduleSchema = z
  .object({
    id: z.string().min(1),
    uid: z.string().min(1),
    kind: z.enum(BACKGROUND_WORKFLOW_KINDS),
    enabled: z.boolean(),
    timezone: z.string().min(1).refine(isValidTimeZone, 'timezone must be a valid IANA zone'),
    cadence: ScheduleCadenceSchema,
    lookbackWindow: z.enum(LOOKBACK_WINDOWS),
    consentVersion: z.string().min(1),
    permittedActions: PermittedActionsSchema,
    notify: NotifyPreferencesSchema,
    nextRunAt: z.string().datetime(),
    lastRunAt: z.string().datetime().optional(),
    lastStatus: z.enum(SCHEDULE_LAST_STATUSES).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type BackgroundSchedule = z.infer<typeof BackgroundScheduleSchema>;

// --- run ------------------------------------------------------------------

/** Lifecycle of one background run (ADR §6). The app owns terminal state —
 * Cloud Tasks is never relied on as a dead-letter queue. */
export const BACKGROUND_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'retryable_failed',
  'terminal_failed',
  'skipped',
  'cancelled',
  'superseded',
] as const;

export type BackgroundRunStatus = (typeof BACKGROUND_RUN_STATUSES)[number];

/** A single execution attempt record. `errorMessage` is sanitized — only a
 * stable class/code, never a raw third-party exception (ADR §Error
 * sanitization). */
export const BackgroundRunSchema = z
  .object({
    id: z.string().min(1),
    uid: z.string().min(1),
    scheduleId: z.string().min(1),
    kind: z.enum(BACKGROUND_WORKFLOW_KINDS),
    status: z.enum(BACKGROUND_RUN_STATUSES),
    // `{scheduleId}:{kind}:{scheduledFor}` — persisted for auditability even
    // when the public Cloud Tasks task ID is hashed/shortened (ADR §4).
    idempotencyKey: z.string().min(1),
    scheduledFor: z.string().datetime(),
    inputWindowStart: z.string().datetime(),
    inputWindowEnd: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
    attempt: z.number().int().min(0),
    leaseExpiresAt: z.string().datetime().optional(),
    outputRef: z.string().min(1).optional(),
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().optional(),
    model: z.string().min(1).optional(),
    tokenCostEstimate: z.number().nonnegative().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type BackgroundRun = z.infer<typeof BackgroundRunSchema>;

// --- proposed action ------------------------------------------------------

/** A write the run proposes but never performs — it needs foreground
 * confirmation before routing to the existing Workspace write tools. */
export const PROPOSED_ACTION_TYPES = [
  'archive_message',
  'create_task',
  'create_calendar_event',
] as const;

export type ProposedActionType = (typeof PROPOSED_ACTION_TYPES)[number];

export const PROPOSED_ACTION_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'executed',
  'failed',
] as const;

export type ProposedActionStatus = (typeof PROPOSED_ACTION_STATUSES)[number];

/** Result of executing a proposed action once it's approved in foreground.
 * `ref` is the created/changed Workspace resource id; `errorCode` is a stable
 * sanitized class, never a raw API message. */
export const ProposedActionResultSchema = z
  .object({
    ok: z.boolean(),
    ref: z.string().min(1).optional(),
    errorCode: z.string().min(1).optional(),
  })
  .strict();

export type ProposedActionResult = z.infer<typeof ProposedActionResultSchema>;

export const BackgroundProposedActionSchema = z
  .object({
    id: z.string().min(1),
    uid: z.string().min(1),
    runId: z.string().min(1),
    notificationId: z.string().min(1).optional(),
    type: z.enum(PROPOSED_ACTION_TYPES),
    status: z.enum(PROPOSED_ACTION_STATUSES),
    // Stable Workspace message IDs the action derives from; never raw content.
    // At least one — an auditable action must tie back to a concrete message.
    sourceMessageIds: z.array(z.string().min(1)).min(1),
    // Short client-safe description ("Archive 4 newsletters from last week").
    summary: z.string().min(1),
    // Action-specific arguments (e.g. task title, event start). Schema-free
    // by design — the foreground approval flow maps these onto the existing
    // Workspace write tools, which own their own arg validation.
    params: z.record(z.string(), z.unknown()).optional(),
    result: ProposedActionResultSchema.optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type BackgroundProposedAction = z.infer<typeof BackgroundProposedActionSchema>;

// --- notification / digest ------------------------------------------------

export const NOTIFICATION_STATUSES = ['unread', 'read', 'dismissed', 'acted_on'] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** One row in a digest. Carries stable Workspace IDs + a short snippet only —
 * enough for the user to recognise the message without re-opening Gmail, and
 * never the full body/address (ADR §Security). */
export const BackgroundNotificationItemSchema = z
  .object({
    messageId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    bucket: z.enum(['noise', 'actions', 'events', 'info']),
    subject: z.string().min(1),
    snippet: z.string().min(1),
  })
  .strict();

export type BackgroundNotificationItem = z.infer<typeof BackgroundNotificationItemSchema>;

export const BackgroundNotificationSchema = z
  .object({
    id: z.string().min(1),
    uid: z.string().min(1),
    runId: z.string().min(1),
    kind: z.enum(BACKGROUND_WORKFLOW_KINDS),
    status: z.enum(NOTIFICATION_STATUSES),
    title: z.string().min(1),
    summary: z.string().min(1),
    items: z.array(BackgroundNotificationItemSchema),
    // IDs of `BackgroundProposedAction` records requiring foreground confirm.
    proposedActions: z.array(z.string().min(1)),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export type BackgroundNotification = z.infer<typeof BackgroundNotificationSchema>;

// --- task-id sanitization -------------------------------------------------

/**
 * Cloud Tasks task IDs allow only letters, numbers, hyphens, and underscores
 * (ADR §4). Replace every other character (colons in ISO timestamps, dots,
 * slashes, `@` in raw uids, …) with `_` so a deterministic id built from
 * schedule/kind/timestamp is always a valid task name.
 *
 * This is intentionally pure character replacement — it does NOT hash or
 * shorten; callers hash long/sensitive identifiers (truncated SHA-256) before
 * composing the id, then pass the composed string here as a final guard.
 */
export function sanitizeTaskId(input: string): string {
  return input.replace(/[^A-Za-z0-9_-]/g, '_');
}
