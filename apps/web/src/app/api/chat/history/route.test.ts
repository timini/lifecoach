import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const ORIGINAL_ENV = { ...process.env };

describe('GET /api/chat/history', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, AGENT_URL: 'http://agent.test' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('returns 400 when required params are missing', async () => {
    const res = await GET(new Request('http://localhost/api/chat/history'));
    expect(res.status).toBe(400);
  });

  it('returns 500 when AGENT_URL is not configured', async () => {
    process.env.AGENT_URL = '';
    const res = await GET(new Request('http://localhost/api/chat/history?userId=u&sessionId=s'));
    expect(res.status).toBe(500);
  });

  it('forwards to the agent and returns its events', async () => {
    const events = [{ id: 'e1', author: 'user', content: { parts: [{ text: 'hi' }] } }];
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET(
      new Request('http://localhost/api/chat/history?userId=u&sessionId=s', {
        headers: { authorization: 'Bearer tok' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual(events);

    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error('fetch not called');
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('http://agent.test/history?userId=u&sessionId=s');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
  });

  it('returns 502 when the agent errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await GET(new Request('http://localhost/api/chat/history?userId=u&sessionId=s'));
    expect(res.status).toBe(502);
  });
});
