import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectNotion, fetchNotionStatus, revokeNotion } from './notion';

function fakeUser(idToken = 'firebase-id-token'): User {
  return { getIdToken: vi.fn(async () => idToken) } as unknown as User;
}

const ORIGINAL_ENV = { ...process.env };

/**
 * Builds a fake `window` good enough for connectNotion. The runtime is
 * node (no jsdom in this monorepo) so we stub the message-event surface
 * by hand: addEventListener captures the handler, fireMessage invokes
 * it. window.open returns a fake popup whose `closed` flag can be
 * flipped to drive the close-poll branch.
 */
function setupFakeWindow(
  opts: {
    popupClosed?: boolean;
    popup?: unknown;
  } = {},
) {
  const listeners = new Set<(e: { origin: string; data: unknown }) => void>();
  // Distinguish "popup explicitly null (blocked)" from "no popup arg".
  const popup =
    'popup' in opts ? opts.popup : { closed: opts.popupClosed ?? false, close: vi.fn() };
  const open = vi.fn().mockReturnValue(popup);
  const win = {
    location: { origin: 'https://app.test' },
    open,
    addEventListener: vi.fn((type: string, h: (e: { origin: string; data: unknown }) => void) => {
      if (type === 'message') listeners.add(h);
    }),
    removeEventListener: vi.fn(
      (type: string, h: (e: { origin: string; data: unknown }) => void) => {
        if (type === 'message') listeners.delete(h);
      },
    ),
  };
  vi.stubGlobal('window', win);
  return {
    win,
    open,
    popup,
    fireMessage(origin: string, data: unknown) {
      for (const h of listeners) h({ origin, data });
    },
  };
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID: 'test-notion-client',
  };
  // Force a deterministic CSRF state so the tests' fireMessage payloads
  // match what connectNotion generated. node 19+ ships crypto.randomUUID
  // natively; we always override it for these tests.
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  process.env = ORIGINAL_ENV;
});

describe('fetchNotionStatus', () => {
  it('returns the agent-proxy status with Bearer token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connected: true,
          workspaceName: 'Tim Notion',
          grantedAt: '2026-05-14T00:00:00Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const status = await fetchNotionStatus(fakeUser('id-1'));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/notion/status',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer id-1' }),
      }),
    );
    expect(status).toEqual({
      connected: true,
      workspaceName: 'Tim Notion',
      grantedAt: '2026-05-14T00:00:00Z',
    });
  });

  it('returns disconnected fallback on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const status = await fetchNotionStatus(fakeUser());
    expect(status).toEqual({ connected: false, workspaceName: null, grantedAt: null });
  });

  it('throws on other 4xx/5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(fetchNotionStatus(fakeUser())).rejects.toThrow(/notion_status_failed/);
  });

  it('coerces missing fields to safe defaults', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const status = await fetchNotionStatus(fakeUser());
    expect(status).toEqual({ connected: false, workspaceName: null, grantedAt: null });
  });
});

describe('revokeNotion', () => {
  it('DELETEs with the Bearer token and parses the response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: false, workspaceName: null, grantedAt: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const status = await revokeNotion(fakeUser('id-x'));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/notion',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: 'Bearer id-x' }),
      }),
    );
    expect(status.connected).toBe(false);
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));
    await expect(revokeNotion(fakeUser())).rejects.toThrow(/notion_revoke_failed/);
  });
});

describe('connectNotion', () => {
  it('throws when NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID is unset', async () => {
    setupFakeWindow();
    process.env.NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID = undefined;
    await expect(connectNotion(fakeUser())).rejects.toThrow(/NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID/);
  });

  it('throws when the popup is blocked', async () => {
    setupFakeWindow({ popup: null });
    await expect(connectNotion(fakeUser())).rejects.toThrow(/oauth_popup_blocked/);
  });

  it('rejects on state mismatch', async () => {
    const harness = setupFakeWindow();
    const connectPromise = connectNotion(fakeUser());
    // Wait a tick so the listener is registered before we fire.
    await Promise.resolve();
    harness.fireMessage('https://app.test', {
      type: 'notion-oauth-done',
      code: 'CODE',
      state: 'wrong-state',
    });
    await expect(connectPromise).rejects.toThrow(/oauth_state_mismatch/);
  });

  it('rejects when the popup is closed without sending a message', async () => {
    vi.useFakeTimers();
    setupFakeWindow({ popupClosed: true });
    const connectPromise = connectNotion(fakeUser());
    // Attach the rejection assertion BEFORE driving timers, so the
    // rejection isn't briefly unhandled while we advance time.
    const settled = expect(connectPromise).rejects.toThrow(/oauth_popup_closed/);
    await vi.advanceTimersByTimeAsync(600);
    await settled;
  });

  it('exchanges the code with the agent proxy on success', async () => {
    const harness = setupFakeWindow();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connected: true,
          workspaceName: 'Tim',
          grantedAt: '2026-05-14T00:00:00Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const connectPromise = connectNotion(fakeUser('id-1'));
    await Promise.resolve();
    // Reply with the matching CSRF state (the stubbed crypto.randomUUID
    // returns all-zeros).
    harness.fireMessage('https://app.test', {
      type: 'notion-oauth-done',
      code: 'AUTH-CODE',
      state: '00000000-0000-0000-0000-000000000000',
    });

    const status = await connectPromise;
    expect(status.connected).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/notion/oauth-exchange',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer id-1',
          'content-type': 'application/json',
        }),
        body: expect.stringContaining('AUTH-CODE'),
      }),
    );
  });

  it('ignores postMessage from a different origin', async () => {
    const harness = setupFakeWindow();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: true, workspaceName: null, grantedAt: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const connectPromise = connectNotion(fakeUser());
    await Promise.resolve();
    // Foreign origin first — must be ignored.
    harness.fireMessage('https://attacker.example', {
      type: 'notion-oauth-done',
      code: 'EVIL',
      state: '00000000-0000-0000-0000-000000000000',
    });
    // Then the legit one.
    harness.fireMessage('https://app.test', {
      type: 'notion-oauth-done',
      code: 'GOOD',
      state: '00000000-0000-0000-0000-000000000000',
    });

    await connectPromise;
    const body = String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body);
    expect(body).toContain('GOOD');
    expect(body).not.toContain('EVIL');
  });

  it('ignores postMessages that do not match the notion-oauth-done shape', async () => {
    const harness = setupFakeWindow();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: true, workspaceName: null, grantedAt: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const connectPromise = connectNotion(fakeUser());
    await Promise.resolve();
    // Wrong type — ignored.
    harness.fireMessage('https://app.test', { type: 'unrelated', code: 'X', state: 'X' });
    // Then the legit one.
    harness.fireMessage('https://app.test', {
      type: 'notion-oauth-done',
      code: 'OK',
      state: '00000000-0000-0000-0000-000000000000',
    });

    await connectPromise;
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('throws on agent-proxy 4xx', async () => {
    const harness = setupFakeWindow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));

    const connectPromise = connectNotion(fakeUser());
    await Promise.resolve();
    harness.fireMessage('https://app.test', {
      type: 'notion-oauth-done',
      code: 'C',
      state: '00000000-0000-0000-0000-000000000000',
    });

    await expect(connectPromise).rejects.toThrow(/notion_oauth_exchange_failed/);
  });
});
