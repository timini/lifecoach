/**
 * Day-rhythm sessionId helpers — every coaching day is its own session,
 * keyed deterministically on `${uid}-${YYYY-MM-DD}`.
 *
 * No localStorage anymore: the previous per-uid random-UUID mapping was
 * needed to make the same uid hit the same session across sign-outs;
 * now the session id is fully derived, so we just compute it on demand.
 * The agent's Firestore lookup (`apps/{app}/users/{uid}/sessions/{id}`)
 * lazily creates the doc on first turn, identical to before.
 *
 * Date is the user's *local coaching date* (browser tz): midnight–04:59
 * carries over to the previous date, matching the agent's wind-down phase.
 * If a user travels across
 * the dateline at midnight they get a fresh session — acceptable for
 * MVP, documented in the plan.
 */

export const COACHING_DAY_START_HOUR = 5;

/** Returns today's coaching date in the browser's local tz as `YYYY-MM-DD`. */
export function todayDateLocal(): string {
  return coachingDateLocal(new Date());
}

/** Format the coaching date containing `d` in the browser's local timezone. */
export function coachingDateLocal(d: Date): string {
  if (d.getHours() >= COACHING_DAY_START_HOUR) return dateLocal(d);
  return dateLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}

/**
 * Format a Date as `YYYY-MM-DD` in the browser's tz. Exposed (and not
 * baked into todayDateLocal) so tests can drive a deterministic date.
 */
export function dateLocal(d: Date): string {
  // `en-CA` formats as `YYYY-MM-DD` natively. Using a localised formatter
  // (rather than toISOString().slice(0,10)) keeps us in the user's tz —
  // the difference matters around midnight UTC for users in non-UTC tzs.
  return d.toLocaleDateString('en-CA');
}

/**
 * Stable session id for a given uid and local date. Same shape used as
 * the Firestore session doc id, so two callers with the same inputs hit
 * the same chat. Empty uid is rejected to prevent accidental
 * cross-account sessions.
 */
export function sessionIdFor(uid: string, dateLocalStr: string): string {
  if (!uid) throw new Error('sessionIdFor: uid is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocalStr)) {
    throw new Error(`sessionIdFor: dateLocalStr must be YYYY-MM-DD, got ${dateLocalStr}`);
  }
  return `${uid}-${dateLocalStr}`;
}

/** Today's sessionId for `uid` — convenience wrapper. */
export function sessionIdForToday(uid: string): string {
  return sessionIdFor(uid, todayDateLocal());
}
