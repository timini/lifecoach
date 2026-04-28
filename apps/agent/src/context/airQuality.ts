/**
 * Open-Meteo air-quality client. Returns the European AQI plus PM2.5, PM10,
 * ozone and the three main pollens. Free, no API key.
 *
 * Cache key rounds to 1 decimal place (~10 km) — air quality varies less
 * granularly than weather, and we don't want to hammer the upstream when
 * a city full of users all have slightly different lat/lng.
 *
 * Mirrors the shape of `weather.ts` so the call site / DI pattern is
 * identical.
 */

import type { Coord } from './weather.js';

export interface AirQuality {
  /** European AQI 0-500. >50 is "moderate" or worse. */
  aqi: number;
  pm2_5: number;
  pm10: number;
  ozone: number;
  pollen: { alder: number; grass: number; ragweed: number };
}

export type AirQualityFetcher = (url: string) => Promise<Response>;

export interface AirQualityClient {
  get(coord: Coord): Promise<AirQuality | null>;
}

interface CacheEntry {
  at: number;
  value: AirQuality | null;
}

const TTL_MS = 60 * 60_000;

export function roundForCacheAQ(c: Coord): Coord {
  return { lat: roundTo(c.lat, 1), lng: roundTo(c.lng, 1) };
}

function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function cacheKey(c: Coord): string {
  const r = roundForCacheAQ(c);
  return `${r.lat},${r.lng}`;
}

export function createAirQualityClient(
  deps: {
    fetcher?: AirQualityFetcher;
    now?: () => number;
    ttlMs?: number;
  } = {},
): AirQualityClient {
  const fetcher = deps.fetcher ?? ((url: string) => fetch(url));
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? TTL_MS;
  const cache = new Map<string, CacheEntry>();

  return {
    async get(coord: Coord): Promise<AirQuality | null> {
      const key = cacheKey(coord);
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) return hit.value;

      const { lat, lng } = roundForCacheAQ(coord);
      const fields = 'european_aqi,pm2_5,pm10,ozone,alder_pollen,grass_pollen,ragweed_pollen';
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=${fields}&timezone=auto`;

      try {
        const res = await fetcher(url);
        if (res.status !== 200) {
          cache.set(key, { at: now(), value: null });
          return null;
        }
        const body = (await res.json()) as AirQualityResponse;
        const aq: AirQuality = {
          aqi: body.current.european_aqi ?? 0,
          pm2_5: body.current.pm2_5 ?? 0,
          pm10: body.current.pm10 ?? 0,
          ozone: body.current.ozone ?? 0,
          pollen: {
            alder: body.current.alder_pollen ?? 0,
            grass: body.current.grass_pollen ?? 0,
            ragweed: body.current.ragweed_pollen ?? 0,
          },
        };
        cache.set(key, { at: now(), value: aq });
        return aq;
      } catch {
        cache.set(key, { at: now(), value: null });
        return null;
      }
    },
  };
}

interface AirQualityResponse {
  current: {
    time: string;
    european_aqi?: number;
    pm2_5?: number;
    pm10?: number;
    ozone?: number;
    alder_pollen?: number;
    grass_pollen?: number;
    ragweed_pollen?: number;
  };
}
