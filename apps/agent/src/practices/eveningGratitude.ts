/**
 * Evening gratitude practice.
 *
 * When ON, the coach gently invites one thing the user is grateful for —
 * but only between 18:00 and 23:00 local time, and only if today's
 * entry hasn't been logged yet. The `log_gratitude` tool captures the
 * answer to user.yaml under `practices.evening_gratitude.entries[]`
 * and stamps `last_logged: <today YYYY-MM-DD>` so we don't double-ask.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { Practice, PracticeCtx, PracticeDeps } from './types.js';

const ID = 'evening_gratitude';
const ENTRIES_PATH = `practices.${ID}.entries`;
const LAST_LOGGED_PATH = `practices.${ID}.last_logged`;
const EVENING_START_HOUR = 18;
const EVENING_END_HOUR = 23;

interface GratitudeEntry {
  date: string; // YYYY-MM-DD local
  text: string;
  ts: string; // ISO UTC
}

function localDateAndHour(now: Date, tz: string | null): { date: string; hour: number } {
  // en-CA reliably returns YYYY-MM-DD in the chosen timezone; sv-SE for
  // 24-hour HH so we can read the hour without locale surprises.
  const tzOpt = tz ?? 'UTC';
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzOpt,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const hourStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tzOpt,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return { date, hour: Number.parseInt(hourStr, 10) };
}

function directive(ctx: PracticeCtx): string | null {
  const { date: today, hour } = localDateAndHour(ctx.now, ctx.timezone);
  if (hour < EVENING_START_HOUR || hour >= EVENING_END_HOUR + 1) return null;
  const lastLogged =
    typeof ctx.practiceState.last_logged === 'string'
      ? (ctx.practiceState.last_logged as string)
      : null;
  if (lastLogged === today) return null;
  return `EVENING_GRATITUDE (practice on, evening window, not yet logged today):
It's evening and the user hasn't shared a gratitude entry yet today. When the moment fits — after a check-in, between topics, or as the chat winds down — gently invite one thing they're grateful for. ONE soft ask only; if they decline or change subject, drop it. When they share, immediately call log_gratitude({ text: "<their words, lightly cleaned up>" }) and continue normally without announcing the save.`;
}

function createLogGratitudeTool(deps: PracticeDeps, uid: string): FunctionTool {
  const parameters = z.object({
    text: z
      .string()
      .min(2)
      .describe("The user's gratitude in their own words. One short line is fine."),
  });

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: 'log_gratitude',
    description:
      "Save the user's evening gratitude entry to their profile. Call this immediately " +
      "when the user shares one thing they're grateful for during an evening check-in. " +
      "Stores the text + today's date and stamps last_logged so we don't re-ask today. " +
      'Never announce the save.',
    parameters,
    execute: async (input: unknown) => {
      const { text } = input as { text: string };
      try {
        const now = new Date();
        // Use UTC for the date stamp at the storage layer; the directive
        // already enforces the evening window in user-local time, so a
        // UTC date here is fine for "did we log today?" idempotency.
        const date = now.toISOString().slice(0, 10);
        const ts = now.toISOString();
        const profile = await deps.profileStore.read(uid).catch(() => undefined);
        const existing = readEntries(profile);
        const next: GratitudeEntry[] = [...existing, { date, text, ts }];
        await deps.profileStore.updatePath(uid, ENTRIES_PATH, next);
        await deps.profileStore.updatePath(uid, LAST_LOGGED_PATH, date);
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

function readEntries(profile: unknown): GratitudeEntry[] {
  if (!profile || typeof profile !== 'object') return [];
  const practices = (profile as Record<string, unknown>).practices;
  if (!practices || typeof practices !== 'object') return [];
  const slot = (practices as Record<string, unknown>)[ID];
  if (!slot || typeof slot !== 'object') return [];
  const entries = (slot as Record<string, unknown>).entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (e): e is GratitudeEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as GratitudeEntry).date === 'string' &&
      typeof (e as GratitudeEntry).text === 'string' &&
      typeof (e as GratitudeEntry).ts === 'string',
  );
}

export const eveningGratitude: Practice = {
  id: ID,
  label: 'Evening gratitude',
  description: 'Each evening, the coach gently invites one thing you’re grateful for and saves it.',
  offerHint:
    'If the user mentions ending their day, winding down, or expresses positive reflection, consider offering Evening gratitude.',
  directive,
  tools: createLogGratitudeTool ? (deps, uid) => [createLogGratitudeTool(deps, uid)] : undefined,
};
