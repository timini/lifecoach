import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WeatherFetcher, createWeatherClient, roundForCache } from './weather.js';

const SAMPLE_RESPONSE = {
  current: {
    time: '2026-04-21T09:00',
    temperature_2m: 18.5,
    weather_code: 2,
    wind_speed_10m: 12,
  },
  current_units: { temperature_2m: '°C' },
  daily: {
    time: ['2026-04-21', '2026-04-22'],
    temperature_2m_max: [22, 20],
    temperature_2m_min: [12, 11],
    weather_code: [2, 3],
  },
};

function fakeFetch(body: unknown = SAMPLE_RESPONSE, status = 200): WeatherFetcher {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('roundForCache', () => {
  it('rounds to 2 decimal places so cache keys share within ~1km', () => {
    expect(roundForCache({ lat: -37.812345, lng: 144.962999 })).toEqual({
      lat: -37.81,
      lng: 144.96,
    });
  });
});

describe('createWeatherClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches and returns normalised weather for a lat/lng', async () => {
    const fetcher = fakeFetch();
    const client = createWeatherClient({ fetcher });
    const w = await client.get({ lat: -37.81, lng: 144.96 });
    expect(w).toMatchObject({
      current: { temperatureC: 18.5 },
      forecast: [
        { date: '2026-04-21', maxC: 22, minC: 12 },
        { date: '2026-04-22', maxC: 20, minC: 11 },
      ],
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatch(
      /latitude=-37.81.*longitude=144.96/,
    );
  });

  it('caches identical locations for 30 minutes (default)', async () => {
    const fetcher = fakeFetch();
    const client = createWeatherClient({ fetcher });

    await client.get({ lat: -37.81, lng: 144.96 });
    await client.get({ lat: -37.81, lng: 144.96 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 29 minutes later — still cached
    vi.advanceTimersByTime(29 * 60_000);
    await client.get({ lat: -37.81, lng: 144.96 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 31 minutes total — expired
    vi.advanceTimersByTime(2 * 60_000 + 1_000);
    await client.get({ lat: -37.81, lng: 144.96 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shares a cache entry across nearby coordinates (rounded)', async () => {
    const fetcher = fakeFetch();
    const client = createWeatherClient({ fetcher });
    await client.get({ lat: -37.812, lng: 144.962 });
    await client.get({ lat: -37.814, lng: 144.963 }); // both round to -37.81,144.96
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null when the upstream responds with non-200', async () => {
    const client = createWeatherClient({ fetcher: fakeFetch('nope', 500) });
    const w = await client.get({ lat: 0, lng: 0 });
    expect(w).toBeNull();
  });
});
