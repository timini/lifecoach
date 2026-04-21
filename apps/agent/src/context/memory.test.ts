import { describe, expect, it, vi } from 'vitest';
import { type MemoryFetcher, createMem0MemoryClient, noopMemoryClient } from './memory.js';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mkFetcher(byUrl: Record<string, () => Promise<Response>>): MemoryFetcher {
  return vi.fn(async (url: string) => {
    for (const [key, fn] of Object.entries(byUrl)) {
      if (url.includes(key)) return fn();
    }
    return new Response('not found', { status: 404 });
  });
}

describe('noopMemoryClient', () => {
  it('search returns an empty array', async () => {
    const m = noopMemoryClient();
    expect(await m.search('u', 'anything', 5)).toEqual([]);
  });

  it('save resolves without doing anything', async () => {
    const m = noopMemoryClient();
    await expect(m.save('u', 'anything')).resolves.toBeUndefined();
  });
});

describe('createMem0MemoryClient', () => {
  it('search returns memories from the v1/memories/search response', async () => {
    const fetcher = mkFetcher({
      '/v1/memories/search': async () =>
        okJson([
          { memory: 'User has two kids — Wren and Silvie.', score: 0.92 },
          { memory: 'Trains for a half-marathon.', score: 0.71 },
        ]),
    });
    const m = createMem0MemoryClient({ apiKey: 'k', fetcher });
    const results = await m.search('u1', 'kids', 5);
    expect(results).toEqual([
      { text: 'User has two kids — Wren and Silvie.' },
      { text: 'Trains for a half-marathon.' },
    ]);
    const call = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    const [url, init] = call as [string, RequestInit];
    expect(url).toContain('/v1/memories/search');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Token k');
    expect(JSON.parse(init.body as string)).toMatchObject({
      query: 'kids',
      user_id: 'u1',
      limit: 5,
    });
  });

  it('search tolerates alternative response shapes (results array, empty, null)', async () => {
    const m1 = createMem0MemoryClient({
      apiKey: 'k',
      fetcher: mkFetcher({
        '/v1/memories/search': async () =>
          okJson({ results: [{ memory: 'one' }, { memory: 'two' }] }),
      }),
    });
    expect(await m1.search('u', 'q', 5)).toEqual([{ text: 'one' }, { text: 'two' }]);

    const m2 = createMem0MemoryClient({
      apiKey: 'k',
      fetcher: mkFetcher({ '/v1/memories/search': async () => okJson(null) }),
    });
    expect(await m2.search('u', 'q', 5)).toEqual([]);
  });

  it('search returns empty array on non-200 (never throws)', async () => {
    const m = createMem0MemoryClient({
      apiKey: 'k',
      fetcher: async () => new Response('nope', { status: 500 }),
    });
    expect(await m.search('u', 'q', 5)).toEqual([]);
  });

  it('save POSTs v1/memories with messages[] and user_id', async () => {
    const fetcher = mkFetcher({
      '/v1/memories/': async () => okJson({ id: 'm1' }),
    });
    const m = createMem0MemoryClient({ apiKey: 'k', fetcher });
    await m.save('u1', 'I love hiking on weekends');
    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/v1\/memories\/?$/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      user_id: 'u1',
      messages: [{ role: 'user', content: 'I love hiking on weekends' }],
    });
  });

  it('save swallows errors (callers must not crash the turn)', async () => {
    const m = createMem0MemoryClient({
      apiKey: 'k',
      fetcher: async () => {
        throw new Error('network down');
      },
    });
    await expect(m.save('u', 'x')).resolves.toBeUndefined();
  });
});
