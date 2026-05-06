/**
 * Practices — toggleable coaching capabilities the user opts into.
 *
 * This file holds the metadata shared between the agent (which owns the
 * runtime behaviour: prompt directive + tools) and the web app (which
 * renders the toggle UI). Behaviour intentionally lives only in the agent
 * — the web client never needs to know what a practice does, only what
 * to label it and what description to show.
 *
 * Adding a new practice: append a metadata entry here AND add a Practice
 * implementation under apps/agent/src/practices/ — the agent's startup-
 * time parity check rejects the build if these two diverge.
 */

export interface PracticeMetadata {
  /** Stable id; also the user-profile key segment (`practices.{id}.*`). */
  id: string;
  /** Short user-facing name (settings tab, switches). */
  label: string;
  /** One-line description; shown next to the toggle. */
  description: string;
}

export const PRACTICE_METADATA: readonly PracticeMetadata[] = [
  {
    id: 'evening_gratitude',
    label: 'Evening gratitude',
    description:
      'Each evening, the coach gently invites one thing you’re grateful for and saves it.',
  },
  {
    id: 'journaling',
    label: 'Journaling',
    description:
      'When something meaningful comes up, the coach offers to capture it as a journal entry.',
  },
  {
    id: 'day_planning',
    label: 'Plan the day',
    description:
      'After the morning check-in, the coach helps you sort 1–3 priorities — and pulls inbox + calendar signal when Workspace is connected.',
  },
] as const;

/** Profile path for the per-practice on/off flag. */
export function practiceEnabledPath(id: string): string {
  return `practices.${id}.enabled`;
}
