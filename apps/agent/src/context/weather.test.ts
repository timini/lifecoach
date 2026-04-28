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
    sunrise: ['2026-04-21T06:32', '2026-04-22T06:34'],
    sunset: ['2026-04-21T18:14', '2026-04-22T18:12'],
    uv_index_max: [7.2, 6.8],
    precipitation_probability_max: [40, 10],
    daylight_duration: [42120, 41880], // seconds — ~11h 42m, ~11h 38m
  },
  hourly: {
    // 24 entries for today, then rest of the week. Tests only care about today's slice.
    time: Array.from({ length: 48 }, (_, i) => {
      const day = i < 24 ? '2026-04-21' : '2026-04-22';
      const hour = i % 24;
      return `${day}T${String(hour).padStart(2, '0')}:00`;
    }),
    precipitation_probability: [
      // today: peak at 15:00 (60%), low elsewhere
      ...Array.from({ length: 24 }, (_, h) => (h === 15 ? 60 : h === 14 ? 30 : h === 16 ? 40 : 10)),
      // tomorrow: noise — should not contribute to today's peak
      ...Array.from({ length: 24 }, () => 5),
    ],
    uv_index: Array.from({ length: 48 }, () => 3),
    cloud_cover: Array.from({ length: 48 }, () => 50),
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

  it('exposes a today block with sunrise, sunset, daylight, UV peak, rain peak', async () => {
    const fetcher = fakeFetch();
    const client = createWeatherClient({ fetcher });
    const w = await client.get({ lat: -37.81, lng: 144.96 });
    expect(w?.today).toEqual({
      sunrise: '2026-04-21T06:32',
      sunset: '2026-04-21T18:14',
      daylightHours: 11.7, // 42120 / 3600 = 11.7
      uvIndexMax: 7.2,
      rainChancePeak: { hour: '2026-04-21T15:00', probability: 60 },
    });
  });

  it('rain peak is null when today has no meaningful rain probability', async () => {
    const dryResponse = {
      ...SAMPLE_RESPONSE,
      hourly: {
        ...SAMPLE_RESPONSE.hourly,
        precipitation_probability: Array.from({ length: 48 }, () => 5),
      },
    };
    const client = createWeatherClient({ fetcher: fakeFetch(dryResponse) });
    const w = await client.get({ lat: -37.81, lng: 144.96 });
    expect(w?.today.rainChancePeak).toBeNull();
  });

  it('asks Open-Meteo for the extended fields (sunrise, UV, precipitation, daylight)', async () => {
    const fetcher = fakeFetch();
    const client = createWeatherClient({ fetcher });
    await client.get({ lat: -37.81, lng: 144.96 });
    const url = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toMatch(/sunrise/);
    expect(url).toMatch(/sunset/);
    expect(url).toMatch(/uv_index_max/);
    expect(url).toMatch(/precipitation_probability_max/);
    expect(url).toMatch(/daylight_duration/);
    expect(url).toMatch(/hourly=.*precipitation_probability/);
  });
});
