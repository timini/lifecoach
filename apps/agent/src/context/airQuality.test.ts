import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AirQualityFetcher, createAirQualityClient, roundForCacheAQ } from './airQuality.js';

const SAMPLE_RESPONSE = {
  current: {
    time: '2026-04-21T09:00',
    european_aqi: 65,
    pm2_5: 35,
    pm10: 50,
    ozone: 80,
    alder_pollen: 0.2,
    grass_pollen: 4.1,
    ragweed_pollen: 0.5,
  },
};

function fakeFetch(body: unknown = SAMPLE_RESPONSE, status = 200): AirQualityFetcher {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('roundForCacheAQ', () => {
  it('rounds to 1 decimal place — air quality varies less granularly than weather (~10km)', () => {
    expect(roundForCacheAQ({ lat: -37.812345, lng: 144.962999 })).toEqual({
      lat: -37.8,
      lng: 145.0,
    });
  });
});

describe('createAirQualityClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches and returns normalised air quality for a lat/lng', async () => {
    const fetcher = fakeFetch();
    const client = createAirQualityClient({ fetcher });
    const aq = await client.get({ lat: -37.81, lng: 144.96 });
    expect(aq).toEqual({
      aqi: 65,
      pm2_5: 35,
      pm10: 50,
      ozone: 80,
      pollen: { alder: 0.2, grass: 4.1, ragweed: 0.5 },
    });
  });

  it('hits the open-meteo air-quality endpoint with the right fields', async () => {
    const fetcher = fakeFetch();
    const client = createAirQualityClient({ fetcher });
    await client.get({ lat: -37.81, lng: 144.96 });
    const url = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toMatch(/air-quality-api\.open-meteo\.com/);
    expect(url).toMatch(/european_aqi/);
    expect(url).toMatch(/pm2_5/);
    expect(url).toMatch(/grass_pollen/);
  });

  it('caches identical regions for 60 minutes (default)', async () => {
    const fetcher = fakeFetch();
    const client = createAirQualityClient({ fetcher });
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

  it('shares a cache entry across nearby coordinates (1-decimal rounding ~10km)', async () => {
    const fetcher = fakeFetch();
    const client = createAirQualityClient({ fetcher });
    await client.get({ lat: -37.82, lng: 144.96 });
    await client.get({ lat: -37.84, lng: 144.97 }); // both round to -37.8, 145.0
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null when the upstream responds with non-200', async () => {
    const client = createAirQualityClient({ fetcher: fakeFetch('nope', 500) });
    const aq = await client.get({ lat: 0, lng: 0 });
    expect(aq).toBeNull();
  });

  it('returns null on fetch throw (network drop) and caches the null', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const client = createAirQualityClient({ fetcher });
    expect(await client.get({ lat: 0, lng: 0 })).toBeNull();
    // Re-call within TTL — same null cached, no second fetch.
    expect(await client.get({ lat: 0, lng: 0 })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
