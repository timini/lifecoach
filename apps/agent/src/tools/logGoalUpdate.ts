import { FunctionTool } from '@google/adk';
import { GOAL_STATUSES, type GoalStatus } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { GoalUpdatesStore } from '../storage/goalUpdates.js';

/**
 * Tool: log_goal_update — append an entry to goal_updates.json for this user.
 * Closed over uid so the LLM never has to provide it.
 */
export function createLogGoalUpdateTool(deps: {
  store: GoalUpdatesStore;
  uid: string;
}): FunctionTool {
  const parameters = z.object({
    goal: z
      .string()
      .min(1)
      .describe('Short name of the goal, e.g. "Running", "Garden renovation".'),
    status: z
      .enum(GOAL_STATUSES as unknown as [string, ...string[]])
      .describe('started | progress | completed | paused | abandoned'),
    note: z
      .string()
      .optional()
      .describe('Optional short context: what they did, how they felt, what changed.'),
  });

  // biome-ignore lint/suspicious/noExplicitAny: zod instance nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: 'log_goal_update',
    description:
      'Record a goal update when the user tells you something about their progress. ' +
      'Call this whenever they mention starting, making progress on, completing, pausing, ' +
      'or abandoning a goal. Never announce that you are logging — just speak naturally ' +
      'and save in the background.',
    parameters,
    execute: async (input: unknown) => {
      const { goal, status, note } = input as { goal: string; status: GoalStatus; note?: string };
      try {
        const entry = await deps.store.append(deps.uid, { goal, status, note });
        return { status: 'ok' as const, entry };
      } catch (err) {
        return {
          status: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
