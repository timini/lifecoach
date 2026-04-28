/**
 * Open-Meteo client for weather context. Results are cached for 30 minutes
 * keyed by lat/lng rounded to 2 decimal places (~1km resolution) so nearby
 * coordinates share a cache entry.
 */

export interface Coord {
  lat: number;
  lng: number;
}

export interface Weather {
  current: { temperatureC: number; windKph: number; code: number; time: string };
  forecast: Array<{ date: string; maxC: number; minC: number; code: number }>;
  /**
   * Today-specific signals the coach uses for "should I run / get morning
   * light / bring a jacket" reasoning. Pre-computed so the LLM doesn't have
   * to scan the hourly array.
   */
  today: {
    sunrise: string;
    sunset: string;
    daylightHours: number;
    uvIndexMax: number;
    /** Peak rain hour today, or null if the whole day is below 20% chance. */
    rainChancePeak: { hour: string; probability: number } | null;
  };
}

export type WeatherFetcher = (url: string) => Promise<Response>;

export interface WeatherClient {
  get(coord: Coord): Promise<Weather | null>;
}

interface CacheEntry {
  at: number;
  value: Weather | null;
}

const TTL_MS = 30 * 60_000;

export function roundForCache(c: Coord): Coord {
  return { lat: roundTo(c.lat, 2), lng: roundTo(c.lng, 2) };
}

function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function cacheKey(c: Coord): string {
  const r = roundForCache(c);
  return `${r.lat},${r.lng}`;
}

export function createWeatherClient(
  deps: {
    fetcher?: WeatherFetcher;
    now?: () => number;
    ttlMs?: number;
  } = {},
): WeatherClient {
  const fetcher = deps.fetcher ?? ((url: string) => fetch(url));
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? TTL_MS;
  const cache = new Map<string, CacheEntry>();

  return {
    async get(coord: Coord): Promise<Weather | null> {
      const key = cacheKey(coord);
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) return hit.value;

      const { lat, lng } = roundForCache(coord);
      const dailyFields =
        'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,precipitation_probability_max,daylight_duration';
      const hourlyFields = 'precipitation_probability,uv_index,cloud_cover';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&daily=${dailyFields}&hourly=${hourlyFields}&forecast_days=7&timezone=auto`;

      try {
        const res = await fetcher(url);
        if (res.status !== 200) {
          cache.set(key, { at: now(), value: null });
          return null;
        }
        const body = (await res.json()) as OpenMeteoResponse;
        const weather: Weather = {
          current: {
            temperatureC: body.current.temperature_2m,
            windKph: body.current.wind_speed_10m,
            code: body.current.weather_code,
            time: body.current.time,
          },
          forecast: body.daily.time.map((date: string, i: number) => ({
            date,
            maxC: body.daily.temperature_2m_max[i] ?? Number.NaN,
            minC: body.daily.temperature_2m_min[i] ?? Number.NaN,
            code: body.daily.weather_code[i] ?? 0,
          })),
          today: buildTodayBlock(body),
        };
        cache.set(key, { at: now(), value: weather });
        return weather;
      } catch {
        cache.set(key, { at: now(), value: null });
        return null;
      }
    },
  };
}

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: number[];
    precipitation_probability_max: number[];
    daylight_duration: number[];
  };
  hourly: {
    time: string[];
    precipitation_probability: number[];
    uv_index: number[];
    cloud_cover: number[];
  };
}

const RAIN_PEAK_MIN = 20;

function buildTodayBlock(body: OpenMeteoResponse): Weather['today'] {
  const todayDate = body.daily.time[0] ?? '';
  // Slice the hourly arrays to today's 24 entries.
  const todayHours: Array<{ time: string; rain: number }> = [];
  for (let i = 0; i < body.hourly.time.length; i++) {
    const t = body.hourly.time[i];
    if (!t || !t.startsWith(todayDate)) continue;
    todayHours.push({ time: t, rain: body.hourly.precipitation_probability[i] ?? 0 });
  }
  const peak = todayHours.reduce<{ time: string; rain: number } | null>(
    (best, cur) => (best === null || cur.rain > best.rain ? cur : best),
    null,
  );
  const rainChancePeak =
    peak && peak.rain >= RAIN_PEAK_MIN ? { hour: peak.time, probability: peak.rain } : null;

  return {
    sunrise: body.daily.sunrise[0] ?? '',
    sunset: body.daily.sunset[0] ?? '',
    daylightHours: roundTo((body.daily.daylight_duration[0] ?? 0) / 3600, 1),
    uvIndexMax: body.daily.uv_index_max[0] ?? 0,
    rainChancePeak,
  };
}
