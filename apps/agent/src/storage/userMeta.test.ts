import { describe, expect, it } from 'vitest';
import type { FirestoreLike } from './firestoreSession.js';
import { type UserMetaDoc, createUserMetaStore } from './userMeta.js';

/**
 * Minimal in-memory FirestoreLike fake — same shape used by the existing
 * workspaceTokens.test.ts. Keeps tests focused on the store's logic, not
 * the Firestore client.
 */
function fakeFirestore(): FirestoreLike & { _data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    _data: data,
    doc(path: string) {
      return {
        async get() {
          const v = data.get(path);
          return { exists: v !== undefined, data: () => v };
        },
        async set(value: unknown) {
          data.set(path, value);
        },
        async delete() {
          data.delete(path);
        },
      };
    },
    collection() {
      return {
        async get() {
          return { docs: [] };
        },
      };
    },
  };
}

describe('userMeta — incrementTurnCount', () => {
  it('creates a fresh doc on first call with chatTurnCount=1, tier=free', async () => {
    const fs = fakeFirestore();
    const store = createUserMetaStore({ firestore: fs, now: () => 1_000 });

    const doc = await store.incrementTurnCount('u-new');

    expect(doc).toMatchObject({
      uid: 'u-new',
      chatTurnCount: 1,
      tier: 'free',
    });
    expect(doc.firstSeenAt).toBe(new Date(1_000).toISOString());
    expect(doc.updatedAt).toBe(new Date(1_000).toISOString());
  });

  it('bumps chatTurnCount on subsequent calls and preserves firstSeenAt', async () => {
    const fs = fakeFirestore();
    let clock = 1_000;
    const store = createUserMetaStore({ firestore: fs, now: () => clock });

    const first = await store.incrementTurnCount('u-1');
    clock = 2_000;
    const second = await store.incrementTurnCount('u-1');
    clock = 3_000;
    const third = await store.incrementTurnCount('u-1');

    expect(first.chatTurnCount).toBe(1);
    expect(second.chatTurnCount).toBe(2);
    expect(third.chatTurnCount).toBe(3);
    // firstSeenAt locked at the original turn timestamp
    expect(third.firstSeenAt).toBe(new Date(1_000).toISOString());
    // updatedAt advances each turn
    expect(third.updatedAt).toBe(new Date(3_000).toISOString());
  });

  it('preserves an existing tier=pro through increments', async () => {
    const fs = fakeFirestore();
    const store = createUserMetaStore({ firestore: fs, now: () => 1_000 });

    await store.setTier('u-pro', 'pro');
    const doc = await store.incrementTurnCount('u-pro');

    expect(doc.tier).toBe('pro');
    expect(doc.chatTurnCount).toBe(1);
  });
});

describe('userMeta — get', () => {
  it('returns null for missing uid', async () => {
    const store = createUserMetaStore({ firestore: fakeFirestore() });
    expect(await store.get('absent')).toBeNull();
  });

  it('round-trips through Firestore', async () => {
    const fs = fakeFirestore();
    const store = createUserMetaStore({ firestore: fs, now: () => 5_000 });
    await store.incrementTurnCount('u-rt');
    const got = await store.get('u-rt');
    expect(got?.chatTurnCount).toBe(1);
    expect(got?.tier).toBe('free');
  });
});

describe('userMeta — setTier', () => {
  it('sets tier=pro on a brand-new doc, leaving chatTurnCount at 0', async () => {
    const fs = fakeFirestore();
    const store = createUserMetaStore({ firestore: fs, now: () => 1_000 });

    const doc = await store.setTier('u-new-pro', 'pro');

    expect(doc).toMatchObject({
      uid: 'u-new-pro',
      tier: 'pro',
      chatTurnCount: 0,
    });
    expect(doc.firstSeenAt).toBe(new Date(1_000).toISOString());
  });

  it('updates tier on an existing doc, preserving chatTurnCount and firstSeenAt', async () => {
    const fs = fakeFirestore();
    let clock = 1_000;
    const store = createUserMetaStore({ firestore: fs, now: () => clock });

    await store.incrementTurnCount('u-x');
    await store.incrementTurnCount('u-x');
    clock = 2_000;

    const doc = await store.setTier('u-x', 'pro');

    expect(doc.tier).toBe('pro');
    expect(doc.chatTurnCount).toBe(2);
    expect(doc.firstSeenAt).toBe(new Date(1_000).toISOString());
    expect(doc.updatedAt).toBe(new Date(2_000).toISOString());
  });

  it('downgrades from pro back to free', async () => {
    const fs = fakeFirestore();
    const store = createUserMetaStore({ firestore: fs });
    await store.setTier('u-y', 'pro');
    const doc = await store.setTier('u-y', 'free');
    expect(doc.tier).toBe('free');
  });
});

describe('userMeta — round-trip integration', () => {
  it('a full free → pro lifecycle keeps the same chatTurnCount', async () => {
    const fs = fakeFirestore();
    const store = createUserMetaStore({ firestore: fs });

    for (let i = 0; i < 5; i++) await store.incrementTurnCount('u-life');
    const beforeUpgrade = await store.get('u-life');
    expect(beforeUpgrade?.chatTurnCount).toBe(5);

    await store.setTier('u-life', 'pro');
    const afterUpgrade = await store.get('u-life');
    expect(afterUpgrade).toMatchObject({
      uid: 'u-life',
      chatTurnCount: 5,
      tier: 'pro',
    } satisfies Partial<UserMetaDoc>);

    // post-upgrade increments still work
    await store.incrementTurnCount('u-life');
    const post = await store.get('u-life');
    expect(post?.chatTurnCount).toBe(6);
    expect(post?.tier).toBe('pro');
  });
});
