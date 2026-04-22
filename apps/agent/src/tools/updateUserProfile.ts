import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { UserProfileStore } from '../storage/userProfile.js';

/**
 * Schema-free profile tool. The coach can invent any dotted path
 * (`pets.name`, `morning_routine.coffee_first`, `volunteering`, ...) and
 * persist it to the user's YAML. See memory/feedback_yaml_schema_free.md.
 *
 * `value` is still a nullable string for the LLM call-site. `resolveValue`
 * does two lightweight coercions as a convenience:
 *   - `age` → number (common enough to bother)
 *   - `goals.{short,medium,long}_term` → JSON-parsed array of strings
 *     (the coach wants lists for goal tiers; the user's schema-free
 *     stance doesn't preclude convenience heuristics)
 * Everything else passes through as a string.
 */
export function createUpdateUserProfileTool(deps: {
  store: UserProfileStore;
  uid: string;
}): FunctionTool {
  const parameters = z.object({
    path: z
      .string()
      .min(1)
      .describe(
        'Dotted path into the user profile YAML (e.g. "name", "family.children", "pets.species", "volunteering"). Invent new keys freely when a fact doesn\'t fit an existing slot — the profile has no fixed schema.',
      ),
    value: z
      .string()
      .nullable()
      .describe(
        'New value as a string. Numbers: stringified (age is coerced back to number). Goals tiers (goals.short_term etc): JSON array string. Null clears the field.',
      ),
  });

  // biome-ignore lint/suspicious/noExplicitAny: zod instance nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: 'update_user_profile',
    description:
      'Persist a single piece of information the user just shared about themselves. ' +
      'Use a dotted path like "family.children", "occupation.title", or invent a new key ' +
      'when a fact doesn\'t fit (e.g. "pets.name", "volunteering"). Call this whenever ' +
      'the user tells you something useful about their life.',
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
