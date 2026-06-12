import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, AGENT_URL: 'http://agent.test' };
});
afterEach(() => {
  process.env = ORIGINAL;
  vi.restoreAllMocks();
});

describe('GET /api/notion/status', () => {
  it('returns 500 when AGENT_URL is missing', async () => {
    process.env.AGENT_URL = undefined;
    const res = await GET(
      new Request('http://localhost/api/notion/status', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(500);
  });

  it('returns 401 when auth header is missing', async () => {
    const res = await GET(new Request('http://localhost/api/notion/status'));
    expect(res.status).toBe(401);
  });

  it('forwards to agent and returns status', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connected: true,
          workspaceName: 'Tim',
          grantedAt: '2026-05-14T00:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const res = await GET(
      new Request('http://localhost/api/notion/status', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(200);
    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://agent.test/notion/status');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = (await res.json()) as { connected: boolean; workspaceName: string };
    expect(body.connected).toBe(true);
    expect(body.workspaceName).toBe('Tim');
  });

  it('coerces 401 from agent into disconnected payload (preserving 401 status)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const res = await GET(
      new Request('http://localhost/api/notion/status', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it('returns 502 on upstream 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await GET(
      new Request('http://localhost/api/notion/status', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(502);
  });

  it('falls back to safe payload when upstream body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
    const res = await GET(
      new Request('http://localhost/api/notion/status', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    const body = (await res.json()) as { connected: boolean };
    expect(body).toEqual({ connected: false, workspaceName: null, grantedAt: null });
  });
});
