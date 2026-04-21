import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PlacesFetcher, createPlacesClient } from './places.js';

const SAMPLE = {
  places: [
    {
      displayName: { text: 'Edinburgh Gardens' },
      formattedAddress: 'Alfred Crescent, Fitzroy North VIC',
      types: ['park', 'point_of_interest'],
      primaryType: 'park',
    },
    {
      displayName: { text: 'Dukes Coffee Roasters' },
      formattedAddress: '247 Flinders Ln, Melbourne VIC',
      types: ['cafe', 'food', 'point_of_interest'],
      primaryType: 'cafe',
    },
  ],
};

function fakeFetcher(body: unknown = SAMPLE, status = 200): PlacesFetcher {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('createPlacesClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns normalised places for a lat/lng', async () => {
    const fetcher = fakeFetcher();
    const client = createPlacesClient({ fetcher, tokenProvider: async () => 'tok' });
    const places = await client.get({ lat: -37.81, lng: 144.96 });
    expect(places).toEqual([
      {
        name: 'Edinburgh Gardens',
        address: 'Alfred Crescent, Fitzroy North VIC',
        type: 'park',
      },
      {
        name: 'Dukes Coffee Roasters',
        address: '247 Flinders Ln, Melbourne VIC',
        type: 'cafe',
      },
    ]);
  });

  it('caches for 60 minutes (default) per rounded lat/lng', async () => {
    const fetcher = fakeFetcher();
    const client = createPlacesClient({ fetcher, tokenProvider: async () => 'tok' });
    await client.get({ lat: -37.81, lng: 144.96 });
    await client.get({ lat: -37.81, lng: 144.96 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(59 * 60_000);
    await client.get({ lat: -37.81, lng: 144.96 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 60_000);
    await client.get({ lat: -37.81, lng: 144.96 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sends Authorization: Bearer from the token provider', async () => {
    const fetcher = fakeFetcher();
    const client = createPlacesClient({ fetcher, tokenProvider: async () => 'abc.def' });
    await client.get({ lat: 0, lng: 0 });
    const [, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer abc.def');
    expect(headers['x-goog-fieldmask']).toContain('places.displayName');
  });

  it('returns empty array on non-200', async () => {
    const client = createPlacesClient({
      fetcher: fakeFetcher('error', 500),
      tokenProvider: async () => 'tok',
    });
    const places = await client.get({ lat: 0, lng: 0 });
    expect(places).toEqual([]);
  });

  it('returns empty array when token provider throws', async () => {
    const fetcher = fakeFetcher();
    const client = createPlacesClient({
      fetcher,
      tokenProvider: async () => {
        throw new Error('no creds');
      },
    });
    const places = await client.get({ lat: 0, lng: 0 });
    expect(places).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
