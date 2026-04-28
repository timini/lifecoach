/**
 * Journaling practice.
 *
 * When ON, the coach offers to capture meaningful moments as journal
 * entries. The `journal_entry` tool stores text + optional mood under
 * `practices.journaling.entries[]`. Always-on directive (no time
 * window): the trigger is the conversation itself.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { Practice, PracticeCtx, PracticeDeps } from './types.js';

const ID = 'journaling';
const ENTRIES_PATH = `practices.${ID}.entries`;
const MAX_INLINE_ENTRIES = 50;

interface JournalEntry {
  ts: string; // ISO UTC
  text: string;
  mood?: string;
}

function directive(_ctx: PracticeCtx): string {
  return `JOURNALING (practice on):
If the user describes something meaningful — a moment, a feeling, a turning point — gently offer to capture it as a journal entry ("want me to journal that for you?"). When they say more (or say yes and continue), call journal_entry({ text: "<verbatim or lightly cleaned>", mood: "<one word if obvious, e.g. 'frustrated' / 'proud' / 'tired'>" }). Don't pitch journaling on every casual remark — pick the genuinely reflective moments.`;
}

function createJournalEntryTool(deps: PracticeDeps, uid: string): FunctionTool {
  const parameters = z.object({
    text: z
      .string()
      .min(2)
      .describe(
        "The journal entry text. Use the user's own words where possible; a paragraph is fine.",
      ),
    mood: z
      .string()
      .nullable()
      .optional()
      .describe('Optional one-word mood tag (e.g. "proud", "tired", "frustrated").'),
  });

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: 'journal_entry',
    description:
      "Save a journal entry to the user's profile. Call this when the user describes a " +
      'meaningful moment, feeling, or reflection AND has opted to journal it. Stores text + ' +
      'optional mood with a UTC timestamp. Never announce the save.',
    parameters,
    execute: async (input: unknown) => {
      const { text, mood } = input as { text: string; mood?: string | null };
      try {
        const ts = new Date().toISOString();
        const profile = await deps.profileStore.read(uid).catch(() => undefined);
        const existing = readEntries(profile);
        const newEntry: JournalEntry = mood ? { ts, text, mood } : { ts, text };
        const combined = [...existing, newEntry];
        // Keep the inline list bounded — older entries can be archived
        // off-profile in a follow-up; for now we just trim the head.
        const next =
          combined.length > MAX_INLINE_ENTRIES
            ? combined.slice(combined.length - MAX_INLINE_ENTRIES)
            : combined;
        await deps.profileStore.updatePath(uid, ENTRIES_PATH, next);
        return { status: 'ok' as const, count: next.length };
      } catch (err) {
        return {
          status: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

function readEntries(profile: unknown): JournalEntry[] {
  if (!profile || typeof profile !== 'object') return [];
  const practices = (profile as Record<string, unknown>).practices;
  if (!practices || typeof practices !== 'object') return [];
  const slot = (practices as Record<string, unknown>)[ID];
  if (!slot || typeof slot !== 'object') return [];
  const entries = (slot as Record<string, unknown>).entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (e): e is JournalEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as JournalEntry).ts === 'string' &&
      typeof (e as JournalEntry).text === 'string',
  );
}

export const journaling: Practice = {
  id: ID,
  label: 'Journaling',
  description:
    'When something meaningful comes up, the coach offers to capture it as a journal entry.',
  offerHint:
    'If the user opens up about a reflection, feeling, or significant moment and journaling could help them process it, consider offering Journaling.',
  directive,
  tools: (deps, uid) => [createJournalEntryTool(deps, uid)],
};
