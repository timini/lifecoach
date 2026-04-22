import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE } from './route';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, AGENT_URL: 'http://agent.test' };
});
afterEach(() => {
  process.env = ORIGINAL;
  vi.restoreAllMocks();
});

describe('DELETE /api/workspace', () => {
  it('returns 401 when auth header is missing', async () => {
    const res = await DELETE(new Request('http://localhost/api/workspace', { method: 'DELETE' }));
    expect(res.status).toBe(401);
  });

  it('forwards DELETE to the agent with auth', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: false, scopes: [], grantedAt: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const res = await DELETE(
      new Request('http://localhost/api/workspace', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(200);
    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://agent.test/workspace');
    expect(call[1].method).toBe('DELETE');
  });

  it('returns 502 when upstream fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await DELETE(
      new Request('http://localhost/api/workspace', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(502);
  });
});
