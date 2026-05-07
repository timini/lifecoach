import { z } from 'zod';

/**
 * Shared shapes for the workspace sub-agent (Gmail / Calendar / Tasks).
 *
 * The sub-agent's read tools project raw `gws` API responses into these
 * shapes before returning to the LLM — base64 bodies decoded, header
 * bloat dropped, irrelevant fields stripped. Both the agent and tests
 * import these schemas to round-trip projection output.
 *
 * Triage output uses `<TRIAGE_REPORT>{json}</TRIAGE_REPORT>` markers
 * emitted by the sub-agent's final answer; the AgentTool wrapper parses
 * them and validates against `TriageReportSchema`.
 */

const MessageHeaderRecord = z.record(z.string(), z.string());

export const MessageProjectionSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    from: z.string(),
    subject: z.string(),
    date: z.string(),
    snippet: z.string(),
    body: z.string(),
    truncated: z.boolean(),
    headers: MessageHeaderRecord.optional(),
  })
  .strict();

export type MessageProjection = z.infer<typeof MessageProjectionSchema>;

const EventTimeSchema = z
  .object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  })
  .strict();

export const EventProjectionSchema = z
  .object({
    id: z.string(),
    calendarId: z.string().optional(),
    summary: z.string(),
    start: EventTimeSchema,
    end: EventTimeSchema,
    location: z.string().optional(),
    attendees: z.array(z.string()).optional(),
    link: z.string().optional(),
    status: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export type EventProjection = z.infer<typeof EventProjectionSchema>;

export const TaskProjectionSchema = z
  .object({
    id: z.string(),
    taskListId: z.string(),
    title: z.string(),
    due: z.string().optional(),
    status: z.enum(['needsAction', 'completed']),
    notes: z.string().optional(),
    completed: z.string().optional(),
  })
  .strict();

export type TaskProjection = z.infer<typeof TaskProjectionSchema>;

const TriageNoiseSchema = z
  .object({
    id: z.string(),
    threadId: z.string().optional(),
    from: z.string(),
    subject: z.string(),
  })
  .strict();

const TriageActionSchema = z
  .object({
    id: z.string(),
    threadId: z.string().optional(),
    from: z.string(),
    subject: z.string(),
    task: z.string(),
  })
  .strict();

const TriageEventSchema = z
  .object({
    id: z.string(),
    threadId: z.string().optional(),
    subject: z.string(),
    proposedStart: z.string(),
    proposedEnd: z.string().optional(),
    location: z.string().optional(),
  })
  .strict();

const TriageInfoSchema = z
  .object({
    id: z.string(),
    threadId: z.string().optional(),
    from: z.string(),
    subject: z.string(),
    note: z.string(),
  })
  .strict();

export const TriageReportSchema = z
  .object({
    noise: z.array(TriageNoiseSchema),
    actions: z.array(TriageActionSchema),
    events: z.array(TriageEventSchema),
    info: z.array(TriageInfoSchema),
  })
  .strict();

export type TriageReport = z.infer<typeof TriageReportSchema>;
