import { FunctionTool } from '@google/adk';
import { PROFILE_WRITABLE_PATHS } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { UserProfileStore } from '../storage/userProfile.js';

/**
 * Returns an ADK tool the agent can call to persist something it learned
 * about the user. The tool is closed over the UID for this turn so the
 * LLM never has to provide it.
 */
export function createUpdateUserProfileTool(deps: {
  store: UserProfileStore;
  uid: string;
}): FunctionTool {
  const parameters = z.object({
    path: z
      .enum(PROFILE_WRITABLE_PATHS as unknown as [string, ...string[]])
      .describe('Dotted path into user.yaml to update. Must be one of the allowed paths.'),
    value: z
      .string()
      .nullable()
      .describe(
        'New value as a string. Numbers: stringified. Goals lists: JSON array string. Null clears the field.',
      ),
  });
  // ADK's FunctionTool generic over zod produces nominal-type fights between
  // our zod instance and the one ADK is generic over — they're the same
  // runtime dep but TS sees them as distinct. Cast here instead of
  // sprinkling `any` through the implementation.
  // biome-ignore lint/suspicious/noExplicitAny: zod instance mismatch with ADK generics
  return new FunctionTool<any>({
    name: 'update_user_profile',
    description:
      'Persist a single piece of information the user just shared about themselves. ' +
      'Use a dotted path like "family.children" or "occupation.title". ' +
      'Call this whenever the user tells you something useful about their life ' +
      '(name, age, job, relationships, goals, preferences).',
    parameters,
    execute: async (input: unknown) => {
      const { path, value } = input as { path: string; value: string | null };
      try {
        const resolved = resolveValue(path, value);
        const profile = await deps.store.updatePath(deps.uid, path, resolved);
        return {
          status: 'ok' as const,
          updated_path: path,
          new_value: resolved,
          profile_after: profile,
        };
      } catch (err) {
        return {
          status: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

const GOAL_LIST_PATHS = new Set(['goals.short_term', 'goals.medium_term', 'goals.long_term']);

function resolveValue(path: string, value: string | null): unknown {
  if (value === null) return null;
  if (path === 'age') {
    const n = Number(value);
    if (Number.isNaN(n)) throw new Error(`age must be numeric, got "${value}"`);
    return n;
  }
  if (GOAL_LIST_PATHS.has(path)) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) {
        throw new Error('must be a JSON array of strings');
      }
      return parsed;
    } catch (err) {
      throw new Error(
        `goals.*_term must be a JSON array of strings, got ${JSON.stringify(value)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return value;
}
