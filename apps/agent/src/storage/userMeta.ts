import type { Tier } from '@lifecoach/user-state';
import type { FirestoreLike } from './firestoreSession.js';

/**
 * Firestore-backed per-uid usage meta.
 *
 * Storage layout — one doc per user:
 *   userMeta/{uid}
 *     { uid, chatTurnCount, firstSeenAt, tier, updatedAt }
 *
 * Used by /chat to:
 *   - increment a counter at the start of every turn
 *   - read tier ('free' | 'pro') to feed into UsageStateMachine
 *
 * Auth-plane boundary: this doc holds no secrets. The LLM never reads it
 * directly — server-side derives a UsageStateMachine policy from
 * (chatTurnCount, tier, userState) and only the policy's effects (model,
 * prompt directive, tool list) reach the LLM context.
 *
 * Concurrency: read-modify-write rather than atomic increment.
 *   - The chat UI gates with `busy`, so a single browser tab can't issue
 *     concurrent /chat calls.
 *   - Two simultaneous tabs could in principle drop an increment. Worst
 *     case is one undercounted turn — no crash, no incorrect tier flip
 *     except at the exact threshold boundary, and the next turn corrects
 *     it. If we observe drift in production we can swap to a Firestore
 *     transaction with FieldValue.increment.
 */

export interface UserMetaDoc {
  uid: string;
  chatTurnCount: number;
  firstSeenAt: string; // ISO
  tier: Tier;
  updatedAt: string; // ISO
}

export interface UserMetaStore {
  get(uid: string): Promise<UserMetaDoc | null>;
  /** Bump chatTurnCount by 1 (or create a fresh doc). Returns the post-write doc. */
  incrementTurnCount(uid: string): Promise<UserMetaDoc>;
  /** Promote / demote between free and pro. Creates the doc if missing. */
  setTier(uid: string, tier: Tier): Promise<UserMetaDoc>;
}

function docPath(uid: string): string {
  return `userMeta/${uid}`;
}

export interface CreateUserMetaStoreDeps {
  firestore: FirestoreLike;
  /** Injected for tests; defaults to Date.now(). */
  now?: () => number;
}

export function createUserMetaStore(deps: CreateUserMetaStoreDeps): UserMetaStore {
  const { firestore } = deps;
  const now = deps.now ?? Date.now;

  async function get(uid: string): Promise<UserMetaDoc | null> {
    const snap = await firestore.doc(docPath(uid)).get();
    if (!snap.exists) return null;
    const data = snap.data() as UserMetaDoc | undefined;
    return data ?? null;
  }

  async function incrementTurnCount(uid: string): Promise<UserMetaDoc> {
    const existing = await get(uid);
    const nowIso = new Date(now()).toISOString();
    const next: UserMetaDoc = existing
      ? {
          ...existing,
          chatTurnCount: existing.chatTurnCount + 1,
          updatedAt: nowIso,
        }
      : {
          uid,
          chatTurnCount: 1,
          firstSeenAt: nowIso,
          tier: 'free',
          updatedAt: nowIso,
        };
    await firestore.doc(docPath(uid)).set(next);
    return next;
  }

  async function setTier(uid: string, tier: Tier): Promise<UserMetaDoc> {
    const existing = await get(uid);
    const nowIso = new Date(now()).toISOString();
    const next: UserMetaDoc = existing
      ? { ...existing, tier, updatedAt: nowIso }
      : {
          uid,
          chatTurnCount: 0,
          firstSeenAt: nowIso,
          tier,
          updatedAt: nowIso,
        };
    await firestore.doc(docPath(uid)).set(next);
    return next;
  }

  return { get, incrementTurnCount, setTier };
}
