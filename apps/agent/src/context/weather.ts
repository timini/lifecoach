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
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7&timezone=auto`;

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
  };
}
