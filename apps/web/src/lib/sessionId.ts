/**
 * Per-uid sessionId helpers backed by localStorage.
 *
 * Why per-uid (instead of a single key): when a user signs out and signs back
 * in with the same identity (e.g., Google), they expect their previous chat
 * to reload. The agent's /history endpoint is keyed on (uid, sessionId), so
 * we have to remember the sessionId we minted for that uid the first time
 * they used this device.
 *
 * Anon users have a uid too, so the same map handles "fresh anon" cleanly:
 * the new uid has no entry, we mint a new sessionId.
 */

const KEY = 'lifecoach.sessionIdByUid';

type Map = Record<string, string>;

function readMap(): Map {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Map;
    }
    return {};
  } catch {
    return {};
  }
}

function writeMap(map: Map): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

export function getSessionId(uid: string): string | null {
  if (!uid) return null;
  const map = readMap();
  return map[uid] ?? null;
}

export function setSessionId(uid: string, sessionId: string): void {
  if (!uid) return;
  const map = readMap();
  map[uid] = sessionId;
  writeMap(map);
}

/**
 * Returns the existing sessionId for the uid, or mints one and stores it.
 */
export function ensureSessionIdForUid(uid: string): string {
  const existing = getSessionId(uid);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  setSessionId(uid, fresh);
  return fresh;
}
