import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PATCH } from './route';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, AGENT_URL: 'http://agent.test' };
});
afterEach(() => {
  process.env = ORIGINAL;
  vi.restoreAllMocks();
});

describe('GET /api/profile', () => {
  it('returns 400 when userId is missing', async () => {
    const res = await GET(new Request('http://localhost/api/profile'));
    expect(res.status).toBe(400);
  });

  it('forwards to agent and returns profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ profile: { name: 'Alex' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const res = await GET(
      new Request('http://localhost/api/profile?userId=u', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { name: string } };
    expect(body.profile.name).toBe('Alex');
  });

  it('returns 502 when agent errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await GET(new Request('http://localhost/api/profile?userId=u'));
    expect(res.status).toBe(502);
  });
});

describe('PATCH /api/profile', () => {
  it('returns 401 when no auth header', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profile: { name: 'Alex' } }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('forwards body + auth to the agent', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const res = await PATCH(
      new Request('http://localhost/api/profile', {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ profile: { name: 'Alex' } }),
      }),
    );
    expect(res.status).toBe(200);
    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://agent.test/profile');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('propagates 401 from the agent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const res = await PATCH(
      new Request('http://localhost/api/profile', {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ profile: {} }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
