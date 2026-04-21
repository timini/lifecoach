import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORIGINAL_ENV = { ...process.env };

function mockFetchOnce(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'content-type': 'text/event-stream' },
    }),
  );
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, AGENT_URL: 'http://agent.test' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('returns 400 if message is missing', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u', sessionId: 's' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 if AGENT_URL is not configured', async () => {
    process.env.AGENT_URL = '';
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u', sessionId: 's', message: 'hi' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('forwards to the agent and streams the SSE response through', async () => {
    const agentBody =
      'data: {"author":"lifecoach","content":{"parts":[{"text":"hey"}]}}\n\nevent: done\ndata: {}\n\n';
    const fetchSpy = mockFetchOnce(agentBody);
    vi.stubGlobal('fetch', fetchSpy);

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u', sessionId: 's', message: 'hi' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain('data: ');
    expect(text).toContain('hey');
    expect(text).toContain('event: done');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://agent.test/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('forwards auth header, location, and timezone to the agent', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      // null body → Response has no default content-type header, which
      // exercises the `?? 'text/event-stream'` fallback branch.
      new Response(null, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer tok123' },
      body: JSON.stringify({
        userId: 'u',
        sessionId: 's',
        message: 'hi',
        location: { lat: -37.81, lng: 144.96, accuracy: 20 },
        timezone: 'Australia/Melbourne',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Content-type falls back to text/event-stream when upstream omits it.
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error('fetch not called');
    const [, init] = call as [unknown, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok123');
    const forwarded = JSON.parse(init.body as string);
    expect(forwarded).toMatchObject({
      location: { lat: -37.81, lng: 144.96 },
      timezone: 'Australia/Melbourne',
    });
  });

  it('propagates non-200 agent responses as 502', async () => {
    vi.stubGlobal('fetch', mockFetchOnce('upstream error', 500));

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u', sessionId: 's', message: 'hi' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});
