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

describe('GET /api/goals', () => {
  it('returns 400 when userId missing', async () => {
    const res = await GET(new Request('http://localhost/api/goals'));
    expect(res.status).toBe(400);
  });

  it('returns 500 when AGENT_URL unset', async () => {
    process.env.AGENT_URL = '';
    const res = await GET(new Request('http://localhost/api/goals?userId=u'));
    expect(res.status).toBe(500);
  });

  it('forwards to agent and returns updates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ updates: [{ goal: 'Run', status: 'progress' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const res = await GET(
      new Request('http://localhost/api/goals?userId=u', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    const body = (await res.json()) as { updates: unknown[] };
    expect(body.updates).toHaveLength(1);
  });

  it('502s when agent errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await GET(new Request('http://localhost/api/goals?userId=u'));
    expect(res.status).toBe(502);
  });
});
