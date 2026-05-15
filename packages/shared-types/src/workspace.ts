import { z } from 'zod';

/**
 * The Google Workspace OAuth scopes we request in one consent popup. Full
 * access on purpose — a personal-assistant app is crippled by read-only.
 * The `/settings` copy is the place where we explain to users what the
 * assistant can do with these in plain English.
 */
export const WORKSPACE_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
] as const;

export type WorkspaceScope = (typeof WORKSPACE_SCOPES)[number];

/**
 * Status returned by GET /workspace/status — never includes any token values.
 * The LLM never sees this (it's a web-UI concern), but we use the same schema
 * across the proxy boundary so the web + agent agree on the shape.
 */
export const WorkspaceStatusSchema = z
  .object({
    connected: z.boolean(),
    scopes: z.array(z.string()),
    grantedAt: z.string().datetime().nullable(),
  })
  .strict();

export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

/**
 * Common context carried by every triage row. The parent agent uses this to
 * build informed confirmation prompts (especially archive prompts) without an
 * extra Gmail read.
 */
export const TriageMessageContextSchema = z
  .object({
    receivedAt: z.string().optional(),
    snippet: z.string().optional(),
    context: z.string().min(1),
  })
  .strict();

export const TriageNoiseSchema = TriageMessageContextSchema.extend({
  id: z.string().min(1),
  threadId: z.string().optional(),
  from: z.string().min(1),
  subject: z.string().min(1),
}).strict();

export const TriageActionSchema = TriageMessageContextSchema.extend({
  id: z.string().min(1),
  threadId: z.string().optional(),
  from: z.string().min(1),
  subject: z.string().min(1),
  task: z.string().min(1),
}).strict();

export const TriageEventSchema = TriageMessageContextSchema.extend({
  id: z.string().min(1),
  threadId: z.string().optional(),
  from: z.string().min(1),
  subject: z.string().min(1),
  proposedStart: z.string().min(1),
  proposedEnd: z.string().optional(),
  location: z.string().optional(),
}).strict();

export const TriageInfoSchema = TriageMessageContextSchema.extend({
  id: z.string().min(1),
  threadId: z.string().optional(),
  from: z.string().min(1),
  subject: z.string().min(1),
  note: z.string().min(1),
}).strict();

export const TriageReportSchema = z
  .object({
    noise: z.array(TriageNoiseSchema),
    actions: z.array(TriageActionSchema),
    events: z.array(TriageEventSchema),
    info: z.array(TriageInfoSchema),
  })
  .strict();

export type TriageMessageContext = z.infer<typeof TriageMessageContextSchema>;
export type TriageNoise = z.infer<typeof TriageNoiseSchema>;
export type TriageAction = z.infer<typeof TriageActionSchema>;
export type TriageEvent = z.infer<typeof TriageEventSchema>;
export type TriageInfo = z.infer<typeof TriageInfoSchema>;
export type TriageReport = z.infer<typeof TriageReportSchema>;
