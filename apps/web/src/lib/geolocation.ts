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

/**
 * Reads the current permission state without triggering a browser prompt.
 * Returns `granted` / `prompt` / `denied` or `null` when the Permissions API
 * is unavailable (some browsers) — callers should treat null as "unknown,
 * wait for user action".
 */
export async function getLocationPermissionState(): Promise<
  'granted' | 'prompt' | 'denied' | null
> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state as 'granted' | 'prompt' | 'denied';
  } catch {
    return null;
  }
}
