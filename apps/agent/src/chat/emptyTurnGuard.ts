/**
 * Empty-turn guard — recovery for the case where Gemini calls a tool but
 * returns no follow-up text. Without this guard:
 *   - The user sees the tool-call badge and silence.
 *   - The empty model turn lands in session history.
 *   - Subsequent user messages get more empty replies because Gemini
 *     mirrors the prior empty turn pattern.
 *
 * Pure helpers, no IO. Wired into:
 *   - The /chat SSE loop (forward guard, prevents new poisoning).
 *   - FirestoreSessionService.getSession (backward sanitiser, repairs
 *     already-poisoned sessions in-memory at load time).
 */

import type { Event } from '@google/adk';

/**
 * Sentinel user message used to nudge the model when its previous turn
 * produced no text. Sent server-side as the `newMessage` for a single
 * retry pass; the prompt explains its meaning to the model. Filtered out
 * of session history at every read site (eventHistory.ts in web,
 * sessionHasUserInteraction in agent, transcriptFromEvents in
 * sessionSummary) so the user never sees it.
 */
export const CONTINUE_SENTINEL = '__continue__';

/** Tool names that mutate user state — recovery copy acknowledges the save. */
const WRITE_TOOLS = new Set(['update_user_profile', 'log_goal_update', 'memory_save']);

/** Tool names that read external data — recovery copy invites a follow-up. */
const READ_TOOLS = new Set(['call_workspace', 'google_search']);

export interface ToolSummary {
  name: string;
}

/**
 * Pick a recovery message to inject when the model called tools but emitted
 * no follow-up text. Copy intentionally invites another user turn so the
 * conversation doesn't dead-end on a robotic "OK".
 */
export function pickRecoveryText(tools: ReadonlyArray<ToolSummary>): string {
  if (tools.length === 0) return 'Done. What next?';
  const allWrites = tools.every((t) => WRITE_TOOLS.has(t.name));
  if (allWrites) return 'Got it — saved.';
  const allReads = tools.every((t) => READ_TOOLS.has(t.name));
  if (allReads) return 'All set — anything jump out, or want me to dig in?';
  return 'Done. What next?';
}

interface PartLike {
  text?: string;
  functionCall?: unknown;
  functionResponse?: unknown;
}

function partsOf(event: Event): PartLike[] {
  return (event.content?.parts as PartLike[] | undefined) ?? [];
}

function hasNonEmptyText(event: Event): boolean {
  return partsOf(event).some((p) => typeof p.text === 'string' && p.text.length > 0);
}

function hasFunctionCall(event: Event): boolean {
  return partsOf(event).some((p) => p.functionCall !== undefined);
}

function hasFunctionResponse(event: Event): boolean {
  return partsOf(event).some((p) => p.functionResponse !== undefined);
}

/**
 * A model event is "poisoned" when it has no visible text, no functionCall,
 * and no functionResponse — i.e. the gemini-3-flash-preview thought-only
 * STOP failure mode. Replaying it through history teaches the model to keep
 * emitting empty turns; we filter these out at load time and replace them
 * with a recovery message.
 */
export function isPoisonedModelEvent(event: Event): boolean {
  if (event.content?.role !== 'model') return false;
  if (hasNonEmptyText(event)) return false;
  if (hasFunctionCall(event)) return false;
  if (hasFunctionResponse(event)) return false;
  return true;
}

/**
 * Find positions in the events array where a synthetic recovery event
 * needs to be inserted to break the silence pattern.
 *
 * Two failure modes are detected:
 *   1. A `user/functionResponse` (framework-returned tool result) not
 *      followed by model text before the next user text or end of array.
 *   2. A `user/text` not followed by model text before the next user text
 *      or end of array — covers the gemini-3-flash-preview thought-only
 *      STOP failure mode where the model emits zero (or empty-text) events.
 *
 * Empty-text model events and tool-call-only model events do not satisfy
 * the "owes a reply" requirement.
 *
 * Returns the indices at which to splice in synthetic events. Positions
 * are in the ORIGINAL array; callers walking the array should account for
 * cumulative shifts when inserting.
 */
export function findEmptyTurnGaps(events: ReadonlyArray<Event>): number[] {
  const gaps: number[] = [];
  let pendingTextResponse = false;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev === undefined) continue;
    const role = ev.content?.role;

    if (role === 'user' && hasFunctionResponse(ev)) {
      // Framework returned a tool result; the model now owes a text reply.
      pendingTextResponse = true;
      continue;
    }
    if (role === 'user' && hasNonEmptyText(ev)) {
      // New user message arriving while the model still owes a reply, OR
      // a sequence of user texts with no model reply in between.
      if (pendingTextResponse) gaps.push(i);
      pendingTextResponse = true;
      continue;
    }
    if (role === 'model' && hasNonEmptyText(ev)) {
      pendingTextResponse = false;
    }
    // role=model with only functionCall, only an empty text part, or any
    // other shape, does not resolve the pending response.
  }
  if (pendingTextResponse) gaps.push(events.length);
  return gaps;
}

/**
 * Build a synthetic Event that carries the recovery text as a model turn.
 * Used both for the live forward guard (persisted via appendEvent) and
 * for the backward sanitiser (spliced in-memory at load time).
 */
export function makeRecoveryEvent(
  text: string,
  invocationId: string,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Event {
  return {
    invocationId,
    author: 'lifecoach',
    id: `recovery-${invocationId}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: now(),
    content: { role: 'model', parts: [{ text }] },
    actions: {
      stateDelta: {},
      artifactDelta: {},
      requestedAuthConfigs: {},
      requestedToolConfirmations: {},
    },
  } as unknown as Event;
}

/**
 * Splice synthetic recovery events into a stored events array at every
 * gap detected by findEmptyTurnGaps, AND drop poisoned model events
 * (empty text, no functionCall) so the model doesn't see its own broken
 * pattern in the prompt history. Returns a NEW array; the input is not
 * mutated. Idempotent: a second pass produces no further changes because
 * recovery events satisfy `hasNonEmptyText` and poisoned events have
 * already been removed.
 */
export function injectRecoveryEvents(events: ReadonlyArray<Event>): Event[] {
  const gaps = findEmptyTurnGaps(events);
  const result: Event[] = [];
  let g = 0;
  for (let i = 0; i < events.length; i++) {
    if (g < gaps.length && gaps[g] === i) {
      result.push(makeRecoveryEvent('Done. What next?', `gap-${i}`));
      g++;
    }
    const ev = events[i];
    if (ev === undefined) continue;
    if (isPoisonedModelEvent(ev)) continue;
    result.push(ev);
  }
  if (g < gaps.length && gaps[g] === events.length) {
    result.push(makeRecoveryEvent('Done. What next?', 'gap-end'));
  }
  return result;
}
