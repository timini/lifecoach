import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, AGENT_URL: 'http://agent.test' };
});
afterEach(() => {
  process.env = ORIGINAL;
  vi.restoreAllMocks();
});

describe('POST /api/workspace/oauth-exchange', () => {
  it('returns 401 when auth header is missing', async () => {
    const res = await POST(
      new Request('http://localhost/api/workspace/oauth-exchange', {
        method: 'POST',
        body: JSON.stringify({ code: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('forwards body + auth to the agent', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: true, scopes: ['x'], grantedAt: 'now' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      new Request('http://localhost/api/workspace/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'abc' }),
      }),
    );
    expect(res.status).toBe(200);
    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://agent.test/workspace/oauth-exchange');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('returns 502 on upstream 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await POST(
      new Request('http://localhost/api/workspace/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'x' }),
      }),
    );
    expect(res.status).toBe(502);
  });

  it('propagates 401 from upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const res = await POST(
      new Request('http://localhost/api/workspace/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('does not echo upstream error body (may contain code)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('raw upstream error with code=abc', { status: 400 })),
    );
    const res = await POST(
      new Request('http://localhost/api/workspace/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'abc' }),
      }),
    );
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('oauth_exchange_failed');
    expect(JSON.stringify(json)).not.toContain('abc');
  });
});
