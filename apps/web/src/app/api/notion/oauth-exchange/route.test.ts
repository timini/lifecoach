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

describe('POST /api/notion/oauth-exchange', () => {
  it('returns 500 when AGENT_URL is missing', async () => {
    process.env.AGENT_URL = undefined;
    const res = await POST(
      new Request('http://localhost/api/notion/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'x', redirect_uri: 'https://app/x' }),
      }),
    );
    expect(res.status).toBe(500);
  });

  it('returns 401 when auth header is missing', async () => {
    const res = await POST(
      new Request('http://localhost/api/notion/oauth-exchange', {
        method: 'POST',
        body: JSON.stringify({ code: 'x', redirect_uri: 'https://app/x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('forwards body + auth to the agent', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: true, workspaceName: 'Tim', grantedAt: 'now' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      new Request('http://localhost/api/notion/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'abc', redirect_uri: 'https://app/x' }),
      }),
    );
    expect(res.status).toBe(200);
    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://agent.test/notion/oauth-exchange');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(String(call[1].body)).toContain('abc');
  });

  it('returns 502 on upstream 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await POST(
      new Request('http://localhost/api/notion/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'x', redirect_uri: 'https://app/x' }),
      }),
    );
    expect(res.status).toBe(502);
  });

  it('propagates 401 from upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const res = await POST(
      new Request('http://localhost/api/notion/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'x', redirect_uri: 'https://app/x' }),
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
      new Request('http://localhost/api/notion/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'abc', redirect_uri: 'https://app/x' }),
      }),
    );
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('oauth_exchange_failed');
    expect(JSON.stringify(json)).not.toContain('abc');
  });

  it('falls back to safe payload when upstream body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
    const res = await POST(
      new Request('http://localhost/api/notion/oauth-exchange', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ code: 'x', redirect_uri: 'https://app/x' }),
      }),
    );
    const body = (await res.json()) as { connected: boolean };
    expect(body).toEqual({ connected: false });
  });
});
