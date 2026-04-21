/**
 * Google Places API (New) client — returns up to 5 interesting places near
 * a given lat/lng. Authenticates via an ADC-sourced OAuth2 access token so
 * no API key has to be created/rotated. Cached 60 minutes keyed by
 * 2-decimal rounded coordinates (same convention as weather).
 */

import { type Coord, roundForCache } from './weather.js';

export interface NearbyPlace {
  name: string;
  address: string;
  type: string;
}

export type PlacesFetcher = (url: string, init: RequestInit) => Promise<Response>;
export type AccessTokenProvider = () => Promise<string>;

export interface PlacesClient {
  get(coord: Coord): Promise<NearbyPlace[]>;
}

interface CacheEntry {
  at: number;
  value: NearbyPlace[];
}

const TTL_MS = 60 * 60_000;
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const RADIUS_M = 2_000;
const INCLUDED_TYPES = ['park', 'cafe', 'gym', 'library', 'bakery'];
const FIELD_MASK = 'places.displayName,places.formattedAddress,places.types,places.primaryType';

function cacheKey(c: Coord): string {
  const r = roundForCache(c);
  return `${r.lat},${r.lng}`;
}

export function createPlacesClient(deps: {
  fetcher?: PlacesFetcher;
  tokenProvider: AccessTokenProvider;
  now?: () => number;
  ttlMs?: number;
}): PlacesClient {
  const fetcher = deps.fetcher ?? ((url: string, init: RequestInit) => fetch(url, init));
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? TTL_MS;
  const cache = new Map<string, CacheEntry>();

  return {
    async get(coord: Coord): Promise<NearbyPlace[]> {
      const key = cacheKey(coord);
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) return hit.value;

      let token: string;
      try {
        token = await deps.tokenProvider();
      } catch {
        cache.set(key, { at: now(), value: [] });
        return [];
      }

      const body = {
        includedTypes: INCLUDED_TYPES,
        maxResultCount: 5,
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: { latitude: coord.lat, longitude: coord.lng },
            radius: RADIUS_M,
          },
        },
      };

      try {
        const res = await fetcher(ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-goog-fieldmask': FIELD_MASK,
          },
          body: JSON.stringify(body),
        });
        if (res.status !== 200) {
          cache.set(key, { at: now(), value: [] });
          return [];
        }
        const parsed = (await res.json()) as {
          places?: Array<{
            displayName?: { text?: string };
            formattedAddress?: string;
            primaryType?: string;
            types?: string[];
          }>;
        };
        const places: NearbyPlace[] = (parsed.places ?? [])
          .map((p) => ({
            name: p.displayName?.text ?? '',
            address: p.formattedAddress ?? '',
            type: p.primaryType ?? p.types?.[0] ?? '',
          }))
          .filter((p) => p.name.length > 0);
        cache.set(key, { at: now(), value: places });
        return places;
      } catch {
        cache.set(key, { at: now(), value: [] });
        return [];
      }
    },
  };
}
