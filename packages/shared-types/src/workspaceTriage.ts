import { z } from 'zod';

/**
 * Structured report returned by the `triage_inbox` workspace AgentTool.
 * The parent coach uses these rows to build user-facing confirmations for
 * archive/calendar/task writes, so every row carries enough context to make
 * a yes/no choice without opening Gmail.
 */

const TriageBaseMessageSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1).optional(),
    from: z.string(),
    subject: z.string(),
    context: z.string().min(1),
  })
  .strict();

export const TriageNoiseSchema = TriageBaseMessageSchema;

export const TriageActionSchema = TriageBaseMessageSchema.extend({
  task: z.string().min(1),
}).strict();

export const TriageEventSchema = TriageBaseMessageSchema.extend({
  proposedStart: z.string().min(1),
  proposedEnd: z.string().min(1).optional(),
  location: z.string().optional(),
}).strict();

export const TriageInfoSchema = TriageBaseMessageSchema.extend({
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
