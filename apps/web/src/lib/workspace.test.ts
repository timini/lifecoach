import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectWorkspace, fetchWorkspaceStatus, revokeWorkspace } from './workspace';

function fakeUser(idToken = 'firebase-id-token'): User {
  return {
    getIdToken: vi.fn(async () => idToken),
  } as unknown as User;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = ORIGINAL_ENV;
});

describe('fetchWorkspaceStatus', () => {
  it('returns the agent-proxy status with Bearer token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connected: true,
          scopes: ['x'],
          grantedAt: '2026-04-22T12:00:00.000Z',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const status = await fetchWorkspaceStatus(fakeUser('tok-1'));
    expect(status.connected).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/workspace/status');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  });

  it('treats 401 as disconnected (no token yet)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const status = await fetchWorkspaceStatus(fakeUser());
    expect(status.connected).toBe(false);
  });

  it('throws on non-401 error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    await expect(fetchWorkspaceStatus(fakeUser())).rejects.toThrow(/status_failed/);
  });
});

describe('connectWorkspace', () => {
  // Module-scoped cache in workspace.ts holds a GIS loader promise; isolate
  // each test with a fresh module import by re-requiring the file.
  it('runs the GIS popup, POSTs the code, and returns parsed status', async () => {
    const requestCode = vi.fn();
    const initCodeClient = vi.fn().mockImplementation(
      (config: {
        callback: (resp: { code?: string; error?: string }) => void;
      }) => {
        requestCode.mockImplementation(() => {
          // Simulate async popup resolution.
          queueMicrotask(() => config.callback({ code: 'abc-123' }));
        });
        return { requestCode };
      },
    );
    // GIS script is "already loaded" — loadGisScript short-circuits.
    vi.stubGlobal('window', {
      google: { accounts: { oauth2: { initCodeClient } } },
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connected: true,
          scopes: ['https://mail.google.com/'],
          grantedAt: '2026-04-22T12:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    // Re-import the module so the cached gisLoader promise is fresh.
    vi.resetModules();
    const mod = await import('./workspace');
    const status = await mod.connectWorkspace(fakeUser('fid-token'));

    expect(status.connected).toBe(true);
    expect(initCodeClient).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'test-client.apps.googleusercontent.com',
        ux_mode: 'popup',
        redirect_uri: 'postmessage',
      }),
    );
    expect(requestCode).toHaveBeenCalled();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/workspace/oauth-exchange');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer fid-token');
    expect(JSON.parse(String(init.body))).toEqual({ code: 'abc-123' });
  });

  it('rejects when the popup returns an error', async () => {
    const initCodeClient = vi.fn().mockImplementation(
      (config: {
        callback: (resp: { code?: string; error?: string }) => void;
      }) => ({
        requestCode: () => {
          queueMicrotask(() => config.callback({ error: 'access_denied' }));
        },
      }),
    );
    vi.stubGlobal('window', {
      google: { accounts: { oauth2: { initCodeClient } } },
    });
    vi.resetModules();
    const mod = await import('./workspace');
    await expect(mod.connectWorkspace(fakeUser())).rejects.toThrow(/access_denied/);
  });

  it('rejects when the oauth-exchange proxy returns non-2xx', async () => {
    const initCodeClient = vi.fn().mockImplementation(
      (config: {
        callback: (resp: { code?: string; error?: string }) => void;
      }) => ({
        requestCode: () => {
          queueMicrotask(() => config.callback({ code: 'abc' }));
        },
      }),
    );
    vi.stubGlobal('window', {
      google: { accounts: { oauth2: { initCodeClient } } },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    vi.resetModules();
    const mod = await import('./workspace');
    await expect(mod.connectWorkspace(fakeUser())).rejects.toThrow(/oauth_exchange_failed/);
  });

  it('throws when NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is missing', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = '';
    vi.stubGlobal('window', {
      google: { accounts: { oauth2: { initCodeClient: vi.fn() } } },
    });
    // Re-import to pick up the cleared env through readEnv inside requireClientId.
    // We don't call resetModules here because the function reads the env at
    // call time, not at import time.
    await expect(connectWorkspace(fakeUser())).rejects.toThrow(
      /NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID/,
    );
  });
});

describe('revokeWorkspace', () => {
  it('DELETEs with Bearer and returns the post-revoke status', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: false, scopes: [], grantedAt: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const status = await revokeWorkspace(fakeUser('tok-x'));
    expect(status.connected).toBe(false);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/workspace');
    expect(init.method).toBe('DELETE');
  });
});
