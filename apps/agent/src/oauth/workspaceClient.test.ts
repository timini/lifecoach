import { describe, expect, it, vi } from 'vitest';
import { type WorkspaceOAuthClientLike, createWorkspaceOAuthClient } from './workspaceClient.js';

function fakeClient(overrides: Partial<WorkspaceOAuthClientLike> = {}): WorkspaceOAuthClientLike {
  return {
    getToken: vi.fn(async () => ({
      tokens: {
        access_token: 'ya29.fake',
        refresh_token: 'r.fake',
        expiry_date: Date.now() + 3600_000,
        scope: 'https://mail.google.com/ https://www.googleapis.com/auth/calendar',
      },
    })),
    refreshAccessToken: vi.fn(async () => ({
      credentials: {
        access_token: 'ya29.refreshed',
        expiry_date: Date.now() + 3600_000,
      },
    })),
    revokeToken: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createWorkspaceOAuthClient.exchangeCode', () => {
  it('exchanges the code for tokens and parses scopes', async () => {
    const c = fakeClient();
    const client = createWorkspaceOAuthClient({ client: c });
    const tokens = await client.exchangeCode('auth-code-123');
    expect(tokens.accessToken).toBe('ya29.fake');
    expect(tokens.refreshToken).toBe('r.fake');
    expect(tokens.scopes).toContain('https://mail.google.com/');
    expect(tokens.scopes).toContain('https://www.googleapis.com/auth/calendar');
    expect(tokens.accessTokenExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws when refresh_token is missing (prompt=consent not used)', async () => {
    const c = fakeClient({
      getToken: vi.fn(async () => ({
        tokens: { access_token: 'a', refresh_token: null, expiry_date: Date.now() + 1000 },
      })),
    });
    const client = createWorkspaceOAuthClient({ client: c });
    await expect(client.exchangeCode('x')).rejects.toThrow(/refresh_token/);
  });

  it('falls back to a ~55m expiry if Google omits expiry_date', async () => {
    const c = fakeClient({
      getToken: vi.fn(async () => ({
        tokens: {
          access_token: 'a',
          refresh_token: 'r',
          scope: 'https://mail.google.com/',
        },
      })),
    });
    const fixedNow = 1_700_000_000_000;
    const client = createWorkspaceOAuthClient({ client: c, now: () => fixedNow });
    const tokens = await client.exchangeCode('x');
    const expected = new Date(fixedNow + 55 * 60 * 1000).toISOString();
    expect(tokens.accessTokenExpiresAt).toBe(expected);
  });
});

describe('createWorkspaceOAuthClient.refreshAccessToken', () => {
  it('returns a refreshed access token', async () => {
    const c = fakeClient();
    const client = createWorkspaceOAuthClient({ client: c });
    const r = await client.refreshAccessToken('r.fake');
    expect(r.accessToken).toBe('ya29.refreshed');
    expect(r.refreshToken).toBeUndefined();
  });

  it('surfaces a rotated refresh token when Google returns one', async () => {
    const c = fakeClient({
      refreshAccessToken: vi.fn(async () => ({
        credentials: {
          access_token: 'ya29.new',
          refresh_token: 'r.rotated',
          expiry_date: Date.now() + 3600_000,
        },
      })),
    });
    const client = createWorkspaceOAuthClient({ client: c });
    const r = await client.refreshAccessToken('r.fake');
    expect(r.refreshToken).toBe('r.rotated');
  });

  it('throws when refresh response has no access_token', async () => {
    const c = fakeClient({
      refreshAccessToken: vi.fn(async () => ({
        credentials: {},
      })),
    });
    const client = createWorkspaceOAuthClient({ client: c });
    await expect(client.refreshAccessToken('r.fake')).rejects.toThrow(/access_token/);
  });
});

describe('createWorkspaceOAuthClient.revokeRefreshToken', () => {
  it('swallows errors from Google (best-effort)', async () => {
    const c = fakeClient({
      revokeToken: vi.fn(async () => {
        throw new Error('already revoked');
      }),
    });
    const client = createWorkspaceOAuthClient({ client: c });
    await expect(client.revokeRefreshToken('r.fake')).resolves.toBeUndefined();
  });

  it('calls revokeToken with the refresh token', async () => {
    const c = fakeClient();
    const client = createWorkspaceOAuthClient({ client: c });
    await client.revokeRefreshToken('r.abc');
    expect(c.revokeToken).toHaveBeenCalledWith('r.abc');
  });
});
