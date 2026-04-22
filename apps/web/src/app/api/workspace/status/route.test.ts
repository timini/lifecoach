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

describe('GET /api/workspace/status', () => {
  it('returns 401 when auth header is missing', async () => {
    const res = await GET(new Request('http://localhost/api/workspace/status'));
    expect(res.status).toBe(401);
  });

  it('forwards to agent and returns status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            connected: true,
            scopes: ['https://mail.google.com/'],
            grantedAt: 'now',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    const res = await GET(
      new Request('http://localhost/api/workspace/status', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; scopes: string[] };
    expect(body.connected).toBe(true);
  });

  it('returns 502 on upstream 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await GET(
      new Request('http://localhost/api/workspace/status', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(502);
  });
});
