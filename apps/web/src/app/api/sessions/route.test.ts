import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const ORIGINAL_ENV = { ...process.env };

describe('GET /api/sessions', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, AGENT_URL: 'http://agent.test' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('returns 500 when AGENT_URL is not configured', async () => {
    process.env.AGENT_URL = '';
    const res = await GET(new Request('http://localhost/api/sessions'));
    expect(res.status).toBe(500);
  });

  it('forwards to the agent with the auth header and returns its sessions', async () => {
    const sessions = [
      { sessionId: 'u-2026-04-29', lastUpdateTime: 300 },
      { sessionId: 'u-2026-04-28', lastUpdateTime: 200 },
    ];
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessions }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET(
      new Request('http://localhost/api/sessions', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual(sessions);

    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error('fetch not called');
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('http://agent.test/sessions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
  });

  it('returns 401 when the agent returns 401 (unauth pass-through)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const res = await GET(new Request('http://localhost/api/sessions'));
    expect(res.status).toBe(401);
  });

  it('returns 502 when the agent errors otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await GET(new Request('http://localhost/api/sessions'));
    expect(res.status).toBe(502);
  });
});
