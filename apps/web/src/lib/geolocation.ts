/**
 * Browser-only geolocation wrapper. NEVER falls back to an IP lookup — if
 * the user denies permission or the API is unavailable, we return null and
 * let the agent operate without location context. This is a hard rule;
 * see CLAUDE.md Invariant #1 and the CI grep guard.
 */

export interface BrowserLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface RequestLocationOptions {
  timeoutMs?: number;
  maximumAgeMs?: number;
  highAccuracy?: boolean;
}

export function requestBrowserLocation(
  opts: RequestLocationOptions = {},
): Promise<BrowserLocation | null> {
  // SSR — no window, no geolocation.
  if (typeof window === 'undefined') return Promise.resolve(null);

  const geo = (typeof navigator !== 'undefined' ? navigator.geolocation : undefined) as
    | Geolocation
    | undefined;
  if (!geo) return Promise.resolve(null);

  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      {
        enableHighAccuracy: opts.highAccuracy ?? false,
        timeout: opts.timeoutMs ?? 10_000,
        maximumAge: opts.maximumAgeMs ?? 5 * 60_000,
      },
    );
  });
}
