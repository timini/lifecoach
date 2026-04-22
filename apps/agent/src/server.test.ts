import type { Event } from '@google/adk';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceOAuthClient } from './oauth/workspaceClient.js';
import { type RunnerLike, createApp } from './server.js';
import type { StoredWorkspaceToken, WorkspaceTokensStore } from './storage/workspaceTokens.js';

function fakeRunner(events: Partial<Event>[]): RunnerLike {
  return {
    appName: 'test',
    sessionService: {
      async createSession() {
        return {
          id: 's',
          userId: 'u',
          appName: 'test',
          events: [],
          state: {},
          lastUpdateTime: 0,
        };
      },
      async getSession() {
        return null;
      },
    },
    async *runAsync() {
      for (const e of events) {
        yield e as Event;
      }
    },
  };
}

function appWith(events: Partial<Event>[] = []) {
  return createApp({ runnerFor: (_params: unknown) => fakeRunner(events) });
}

describe('GET /health — NB: /healthz is reserved by Google Frontend on Cloud Run, use /health', () => {
  it('returns 200 with ok', async () => {
    const res = await request(appWith()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /chat', () => {
  it('streams events from the runner as SSE and terminates with event: done', async () => {
    const events: Partial<Event>[] = [
      { author: 'lifecoach', content: { role: 'model', parts: [{ text: 'Hey there!' }] } },
    ];
    const res = await request(appWith(events))
      .post('/chat')
      .send({ userId: 'u1', sessionId: 's1', message: 'hello' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('data: ');
    expect(res.text).toContain('Hey there!');
    expect(res.text).toContain('event: done');
  });

  it('returns 400 if required fields are missing', async () => {
    const res = await request(appWith()).post('/chat').send({ message: 'hi' });
    expect(res.status).toBe(400);
  });

  it('emits event: error when the runner throws', async () => {
    const app = createApp({
      runnerFor: (_params: unknown) => ({
        appName: 'test',
        sessionService: {
          async createSession() {
            return {
              id: 's',
              userId: 'u',
              appName: 'test',
              events: [],
              state: {},
              lastUpdateTime: 0,
            };
          },
          async getSession() {
            return null;
          },
        },
        async *runAsync() {
          // biome-ignore lint/correctness/useYield: intentional — test the throw path
          throw new Error('boom');
        },
      }),
    });
    const res = await request(app)
      .post('/chat')
      .send({ userId: 'u1', sessionId: 's1', message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('boom');
  });

  it('does not fetch weather when location is absent', async () => {
    const weather = { get: vi.fn() };
    const app = createApp({ runnerFor: (_params: unknown) => fakeRunner([]), weather });
    await request(app).post('/chat').send({ userId: 'u', sessionId: 's', message: 'hi' });
    expect(weather.get).not.toHaveBeenCalled();
  });

  it('fetches weather when location is present', async () => {
    const weather = {
      get: vi.fn().mockResolvedValue({
        current: { temperatureC: 18, windKph: 10, code: 2, time: 'now' },
        forecast: [],
      }),
    };
    const app = createApp({ runnerFor: (_params: unknown) => fakeRunner([]), weather });
    await request(app)
      .post('/chat')
      .send({
        userId: 'u',
        sessionId: 's',
        message: 'hi',
        location: { lat: -37.81, lng: 144.96, accuracy: 20 },
      });
    expect(weather.get).toHaveBeenCalledWith({ lat: -37.81, lng: 144.96 });
  });
});

describe('Workspace OAuth endpoints — LLM never touches auth plane', () => {
  function fakeTokensStore(initial?: StoredWorkspaceToken): WorkspaceTokensStore & {
    _docs: Map<string, StoredWorkspaceToken>;
  } {
    const docs = new Map<string, StoredWorkspaceToken>();
    if (initial) docs.set(initial.uid, initial);
    return {
      _docs: docs,
      get: vi.fn(async (uid: string) => docs.get(uid) ?? null),
      set: vi.fn(async (uid: string, tokens) => {
        const doc: StoredWorkspaceToken = {
          uid,
          accessToken: tokens.accessToken,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshToken: tokens.refreshToken,
          scopes: tokens.scopes,
          grantedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        docs.set(uid, doc);
        return doc;
      }),
      delete: vi.fn(async (uid: string) => {
        docs.delete(uid);
      }),
      getValidAccessToken: vi.fn(async (uid: string) => {
        const d = docs.get(uid);
        if (!d) throw new Error('no-token');
        return d.accessToken;
      }),
    };
  }

  function fakeOAuthClient(): WorkspaceOAuthClient {
    return {
      exchangeCode: vi.fn(async () => ({
        accessToken: 'ya29.fake',
        accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        refreshToken: 'r.fake',
        scopes: ['https://mail.google.com/'],
      })),
      refreshAccessToken: vi.fn(),
      revokeRefreshToken: vi.fn(async () => undefined),
    };
  }

  function appWithWorkspace(
    opts: { verify?: ReturnType<typeof vi.fn>; store?: ReturnType<typeof fakeTokensStore> } = {},
  ) {
    const verify =
      opts.verify ??
      vi.fn(async () => ({
        uid: 'u-1',
        firebase: { sign_in_provider: 'google.com' },
        email_verified: true,
      }));
    const store = opts.store ?? fakeTokensStore();
    const client = fakeOAuthClient();
    const app = createApp({
      runnerFor: () => fakeRunner([]),
      verifyToken: verify,
      workspaceOAuthClient: client,
      workspaceTokensStore: store,
    });
    return { app, store, client, verify };
  }

  it('POST /workspace/oauth-exchange requires Bearer', async () => {
    const { app } = appWithWorkspace({
      verify: vi.fn(async () => null),
    });
    const res = await request(app).post('/workspace/oauth-exchange').send({ code: 'x' });
    expect(res.status).toBe(401);
  });

  it('POST /workspace/oauth-exchange stores tokens and returns connected status', async () => {
    const { app, store, client } = appWithWorkspace();
    const res = await request(app)
      .post('/workspace/oauth-exchange')
      .set('authorization', 'Bearer fake')
      .send({ code: 'auth-code' });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(client.exchangeCode).toHaveBeenCalledWith('auth-code');
    expect(store.set).toHaveBeenCalled();
    // Response does NOT include any token fields.
    const keys = Object.keys(res.body);
    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('refreshToken');
    expect(JSON.stringify(res.body)).not.toMatch(/ya29\.|r\.fake/);
  });

  it('GET /workspace/status returns {connected:false} when no doc', async () => {
    const { app } = appWithWorkspace();
    const res = await request(app).get('/workspace/status').set('authorization', 'Bearer fake');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, scopes: [], grantedAt: null });
  });

  it('GET /workspace/status returns connected + scopes without tokens', async () => {
    const doc: StoredWorkspaceToken = {
      uid: 'u-1',
      accessToken: 'ya29.leak',
      accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshToken: 'r.leak',
      scopes: ['https://mail.google.com/'],
      grantedAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const { app } = appWithWorkspace({ store: fakeTokensStore(doc) });
    const res = await request(app).get('/workspace/status').set('authorization', 'Bearer fake');
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.scopes).toContain('https://mail.google.com/');
    // Critical: response JSON must not contain any token substring.
    expect(JSON.stringify(res.body)).not.toContain('ya29.leak');
    expect(JSON.stringify(res.body)).not.toContain('r.leak');
  });

  it('DELETE /workspace revokes at Google (best-effort) and deletes the doc', async () => {
    const doc: StoredWorkspaceToken = {
      uid: 'u-1',
      accessToken: 'a',
      accessTokenExpiresAt: new Date().toISOString(),
      refreshToken: 'r',
      scopes: [],
      grantedAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const { app, store, client } = appWithWorkspace({ store: fakeTokensStore(doc) });
    const res = await request(app).delete('/workspace').set('authorization', 'Bearer fake');
    expect(res.status).toBe(200);
    expect(client.revokeRefreshToken).toHaveBeenCalledWith('r');
    expect(store.delete).toHaveBeenCalledWith('u-1');
  });

  it('POST /chat flips to workspace_connected when tokens exist', async () => {
    const doc: StoredWorkspaceToken = {
      uid: 'u-1',
      accessToken: 'a',
      accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshToken: 'r',
      scopes: ['https://mail.google.com/'],
      grantedAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const store = fakeTokensStore(doc);
    const runnerFor = vi.fn(() => fakeRunner([]));
    const app = createApp({
      runnerFor,
      verifyToken: vi.fn(async () => ({
        uid: 'u-1',
        firebase: { sign_in_provider: 'google.com' },
        email_verified: true,
      })),
      workspaceTokensStore: store,
    });
    await request(app)
      .post('/chat')
      .set('authorization', 'Bearer fake')
      .send({ userId: 'u-1', sessionId: 's', message: 'hi' });
    expect(runnerFor).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({ userState: 'workspace_connected' }),
      }),
    );
  });

  it('POST /chat stays google_linked when no workspace doc exists', async () => {
    const runnerFor = vi.fn(() => fakeRunner([]));
    const app = createApp({
      runnerFor,
      verifyToken: vi.fn(async () => ({
        uid: 'u-1',
        firebase: { sign_in_provider: 'google.com' },
        email_verified: true,
      })),
      workspaceTokensStore: fakeTokensStore(),
    });
    await request(app)
      .post('/chat')
      .set('authorization', 'Bearer fake')
      .send({ userId: 'u-1', sessionId: 's', message: 'hi' });
    expect(runnerFor).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({ userState: 'google_linked' }),
      }),
    );
  });
});
