import { z } from 'zod';

/**
 * One entry in users/{uid}/goal_updates.json — an append-only JSON array.
 * The last 20 entries are injected into the agent's prompt every turn.
 */

export const GOAL_STATUSES = ['started', 'progress', 'completed', 'paused', 'abandoned'] as const;

export const GoalUpdateSchema = z
  .object({
    timestamp: z.string().datetime(),
    goal: z.string().min(1),
    status: z.enum(GOAL_STATUSES),
    note: z.string().optional(),
  })
  .strict();

export type GoalUpdate = z.infer<typeof GoalUpdateSchema>;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
