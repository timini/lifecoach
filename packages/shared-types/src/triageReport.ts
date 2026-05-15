import { z } from 'zod';

/**
 * Structured output from the workspace triage sub-agent. The parent coach
 * uses the per-message context fields directly in confirmation prompts, so
 * every item carries enough detail for a user to approve/skip writes without
 * opening Gmail.
 */

const TriageMessageContextSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1).optional(),
  from: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  snippet: z.string(),
});

export const TriageNoiseSchema = TriageMessageContextSchema.strict();

export const TriageActionSchema = TriageMessageContextSchema.extend({
  task: z.string().min(1),
}).strict();

export const TriageEventSchema = TriageMessageContextSchema.extend({
  proposedStart: z.string().min(1),
  proposedEnd: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
}).strict();

export const TriageInfoSchema = TriageMessageContextSchema.extend({
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

export type TriageNoise = z.infer<typeof TriageNoiseSchema>;
export type TriageAction = z.infer<typeof TriageActionSchema>;
export type TriageEvent = z.infer<typeof TriageEventSchema>;
export type TriageInfo = z.infer<typeof TriageInfoSchema>;
export type TriageReport = z.infer<typeof TriageReportSchema>;
