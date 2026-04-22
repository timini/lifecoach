import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceOAuthClient } from '../oauth/workspaceClient.js';
import type { FirestoreLike } from './firestoreSession.js';
import { ScopeRequiredError, createWorkspaceTokensStore } from './workspaceTokens.js';

function memoryFirestore(): FirestoreLike & {
  _docs: Map<string, unknown>;
  setCount: () => number;
} {
  const docs = new Map<string, unknown>();
  let sets = 0;
  return {
    _docs: docs,
    setCount: () => sets,
    doc(path: string) {
      return {
        async get() {
          return {
            exists: docs.has(path),
            data: () => docs.get(path),
          };
        },
        async set(value: unknown) {
          sets += 1;
          docs.set(path, value);
          return undefined;
        },
        async delete() {
          docs.delete(path);
          return undefined;
        },
      };
    },
    collection() {
      throw new Error('not used in these tests');
    },
  };
}

function fakeOAuth(overrides: Partial<WorkspaceOAuthClient> = {}): WorkspaceOAuthClient {
  return {
    exchangeCode: vi.fn(),
    refreshAccessToken: vi.fn(async () => ({
      accessToken: 'ya29.refreshed',
      accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })),
    revokeRefreshToken: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createWorkspaceTokensStore — basics', () => {
  it('returns null for a user with no doc', async () => {
    const fs = memoryFirestore();
    const store = createWorkspaceTokensStore({ firestore: fs, oauthClient: fakeOAuth() });
    expect(await store.get('uid-1')).toBeNull();
  });

  it('set + get round-trips a new grant and stamps grantedAt', async () => {
    const fs = memoryFirestore();
    const store = createWorkspaceTokensStore({
      firestore: fs,
      oauthClient: fakeOAuth(),
      now: () => Date.parse('2026-04-22T00:00:00Z'),
    });
    const stored = await store.set('uid-1', {
      accessToken: 'a',
      accessTokenExpiresAt: '2026-04-22T01:00:00.000Z',
      refreshToken: 'r',
      scopes: ['https://mail.google.com/'],
    });
    expect(stored.grantedAt).toBe('2026-04-22T00:00:00.000Z');
    expect(stored.updatedAt).toBe('2026-04-22T00:00:00.000Z');
    const read = await store.get('uid-1');
    expect(read?.refreshToken).toBe('r');
  });

  it('set preserves grantedAt on overwrite but updates updatedAt', async () => {
    const fs = memoryFirestore();
    let currentMs = Date.parse('2026-04-22T00:00:00Z');
    const store = createWorkspaceTokensStore({
      firestore: fs,
      oauthClient: fakeOAuth(),
      now: () => currentMs,
    });
    await store.set('uid-1', {
      accessToken: 'a',
      accessTokenExpiresAt: '2026-04-22T01:00:00Z',
      refreshToken: 'r',
      scopes: ['x'],
    });
    currentMs = Date.parse('2026-04-22T05:00:00Z');
    const next = await store.set('uid-1', {
      accessToken: 'b',
      accessTokenExpiresAt: '2026-04-22T06:00:00Z',
      refreshToken: 'r',
      scopes: ['x'],
    });
    expect(next.grantedAt).toBe('2026-04-22T00:00:00.000Z');
    expect(next.updatedAt).toBe('2026-04-22T05:00:00.000Z');
  });

  it('delete removes the doc', async () => {
    const fs = memoryFirestore();
    const store = createWorkspaceTokensStore({ firestore: fs, oauthClient: fakeOAuth() });
    await store.set('uid-1', {
      accessToken: 'a',
      accessTokenExpiresAt: new Date().toISOString(),
      refreshToken: 'r',
      scopes: [],
    });
    await store.delete('uid-1');
    expect(await store.get('uid-1')).toBeNull();
  });
});

describe('getValidAccessToken', () => {
  it('throws ScopeRequiredError when no doc exists', async () => {
    const fs = memoryFirestore();
    const store = createWorkspaceTokensStore({ firestore: fs, oauthClient: fakeOAuth() });
    await expect(store.getValidAccessToken('uid-x')).rejects.toBeInstanceOf(ScopeRequiredError);
  });

  it('returns the stored access token when still valid', async () => {
    const fs = memoryFirestore();
    const fakeNow = Date.parse('2026-04-22T00:00:00Z');
    const oauth = fakeOAuth();
    const store = createWorkspaceTokensStore({
      firestore: fs,
      oauthClient: oauth,
      now: () => fakeNow,
    });
    await store.set('uid-1', {
      accessToken: 'a',
      accessTokenExpiresAt: new Date(fakeNow + 10 * 60_000).toISOString(),
      refreshToken: 'r',
      scopes: [],
    });
    const tok = await store.getValidAccessToken('uid-1');
    expect(tok).toBe('a');
    expect(oauth.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes when within the skew window', async () => {
    const fs = memoryFirestore();
    const fakeNow = Date.parse('2026-04-22T00:00:00Z');
    const oauth = fakeOAuth({
      refreshAccessToken: vi.fn(async () => ({
        accessToken: 'ya29.refreshed',
        accessTokenExpiresAt: new Date(fakeNow + 3600_000).toISOString(),
      })),
    });
    const store = createWorkspaceTokensStore({
      firestore: fs,
      oauthClient: oauth,
      now: () => fakeNow,
      skewMs: 60_000,
    });
    await store.set('uid-1', {
      accessToken: 'stale',
      accessTokenExpiresAt: new Date(fakeNow + 30_000).toISOString(), // within skew
      refreshToken: 'r',
      scopes: [],
    });
    const tok = await store.getValidAccessToken('uid-1');
    expect(tok).toBe('ya29.refreshed');
    expect(oauth.refreshAccessToken).toHaveBeenCalledWith('r');
    const updated = await store.get('uid-1');
    expect(updated?.accessToken).toBe('ya29.refreshed');
  });

  it('overwrites refresh token when Google rotates it', async () => {
    const fs = memoryFirestore();
    const oauth = fakeOAuth({
      refreshAccessToken: vi.fn(async () => ({
        accessToken: 'ya29.refreshed',
        accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        refreshToken: 'r.rotated',
      })),
    });
    const store = createWorkspaceTokensStore({ firestore: fs, oauthClient: oauth });
    await store.set('uid-1', {
      accessToken: 'a',
      accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'r.old',
      scopes: [],
    });
    await store.getValidAccessToken('uid-1');
    const updated = await store.get('uid-1');
    expect(updated?.refreshToken).toBe('r.rotated');
  });

  it('deletes the doc and throws ScopeRequiredError on refresh failure', async () => {
    const fs = memoryFirestore();
    const oauth = fakeOAuth({
      refreshAccessToken: vi.fn(async () => {
        throw new Error('invalid_grant');
      }),
    });
    const store = createWorkspaceTokensStore({ firestore: fs, oauthClient: oauth });
    await store.set('uid-1', {
      accessToken: 'a',
      accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'r',
      scopes: [],
    });
    await expect(store.getValidAccessToken('uid-1')).rejects.toBeInstanceOf(ScopeRequiredError);
    expect(await store.get('uid-1')).toBeNull();
  });

  it('serialises concurrent refreshes via per-uid mutex', async () => {
    const fs = memoryFirestore();
    let refreshCalls = 0;
    const oauth = fakeOAuth({
      refreshAccessToken: vi.fn(async () => {
        refreshCalls += 1;
        // Simulate network delay so both callers pile up.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          accessToken: 'ya29.once',
          accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        };
      }),
    });
    const store = createWorkspaceTokensStore({ firestore: fs, oauthClient: oauth });
    await store.set('uid-1', {
      accessToken: 'stale',
      accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'r',
      scopes: [],
    });
    const [a, b] = await Promise.all([
      store.getValidAccessToken('uid-1'),
      store.getValidAccessToken('uid-1'),
    ]);
    expect(a).toBe('ya29.once');
    expect(b).toBe('ya29.once');
    expect(refreshCalls).toBe(1);
  });
});
