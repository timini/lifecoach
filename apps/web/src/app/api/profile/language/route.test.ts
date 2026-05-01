import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const cookieMock = { set: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: async () => cookieMock,
}));

import { POST } from './route';

describe('POST /api/profile/language', () => {
  const origAgentUrl = process.env.AGENT_URL;

  beforeEach(() => {
    process.env.AGENT_URL = 'https://agent.test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
    );
    cookieMock.set.mockReset();
  });

  afterEach(() => {
    process.env.AGENT_URL = origAgentUrl ?? '';
    vi.unstubAllGlobals();
  });

  test('400 on invalid language', async () => {
    const res = await POST(
      new Request('http://x/api/profile/language', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({ language: 'xx' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('401 when authorization missing', async () => {
    const res = await POST(
      new Request('http://x/api/profile/language', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language: 'fr' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test('200 sets cookie and forwards to agent on valid input', async () => {
    const res = await POST(
      new Request('http://x/api/profile/language', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({ language: 'fr' }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { language: string };
    expect(json.language).toBe('fr');
    expect(cookieMock.set).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'fr',
      expect.objectContaining({ sameSite: 'lax', path: '/' }),
    );
  });

  test('400 on invalid JSON', async () => {
    const res = await POST(
      new Request('http://x/api/profile/language', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });
});
