import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestBrowserLocation } from './geolocation';

interface GeolocationStub {
  getCurrentPosition: ReturnType<typeof vi.fn>;
}

function stubNavigator(geolocation: GeolocationStub | undefined) {
  vi.stubGlobal('navigator', { geolocation });
}

describe('requestBrowserLocation — browser-only (no IP fallback)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with {lat, lng} on user grant', async () => {
    stubNavigator({
      getCurrentPosition: vi.fn((success: PositionCallback) =>
        success({
          coords: { latitude: -37.81, longitude: 144.96, accuracy: 20 },
          timestamp: Date.now(),
        } as unknown as GeolocationPosition),
      ),
    });

    const loc = await requestBrowserLocation();
    expect(loc).toEqual({ lat: -37.81, lng: 144.96, accuracy: 20 });
  });

  it('resolves to null when the user denies', async () => {
    stubNavigator({
      getCurrentPosition: vi.fn((_success: PositionCallback, error: PositionErrorCallback | null) =>
        error?.({
          code: 1,
          message: 'User denied geolocation',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError),
      ),
    });

    const loc = await requestBrowserLocation();
    expect(loc).toBeNull();
  });

  it('resolves to null when geolocation API is unsupported', async () => {
    stubNavigator(undefined);
    const loc = await requestBrowserLocation();
    expect(loc).toBeNull();
  });

  it('resolves to null when called during SSR (no window)', async () => {
    vi.unstubAllGlobals();
    // No window → SSR context
    const loc = await requestBrowserLocation();
    expect(loc).toBeNull();
  });

  it('NEVER makes network requests for IP-based fallback', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    stubNavigator({
      getCurrentPosition: vi.fn((_success: PositionCallback, error: PositionErrorCallback | null) =>
        error?.({
          code: 1,
          message: 'denied',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError),
      ),
    });

    await requestBrowserLocation();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
