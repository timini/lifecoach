'use client';

export type AnalyticsParams = Record<string, boolean | number | string | null | undefined>;

const MAX_EVENT_NAME_LENGTH = 40;
const MAX_PARAM_VALUE_LENGTH = 100;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function googleAnalyticsMeasurementId(): string | null {
  return process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || null;
}

/**
 * True when the current session is automated (Playwright / WebDriver / most
 * headless browser harnesses). Used to tag GA traffic as `internal` so e2e
 * runs against per-PR previews and dev don't inflate active-user counts.
 *
 * `navigator.webdriver` is set by the WebDriver spec; Playwright leaves it
 * `true` by default. Real-user browsers always report `false` (or absent),
 * so this is safe to use as a "is-bot" signal for our own analytics.
 */
export function isInternalTraffic(): boolean {
  if (typeof navigator === 'undefined' || navigator === null) return false;
  return navigator.webdriver === true;
}

/**
 * Returns the inline JS injected by `<GoogleAnalytics />` to bootstrap gtag.
 *
 * When `navigator.webdriver === true` (Playwright/WebDriver), the script
 * issues `gtag('set', 'traffic_type', 'internal')` before the first config
 * call — GA4 then attaches `traffic_type=internal` to every subsequent
 * event in the session, so the GA admin "Internal Traffic" data filter can
 * exclude e2e runs without modifying any test code.
 *
 * `send_page_view: false` keeps the auto-pageview off; the React layer
 * fires path-change page_views via `trackPageView` so we can strip magic-
 * link tokens from `page_location`.
 */
export function buildAnalyticsBootstrapScript(measurementId: string): string {
  return `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    if (typeof navigator !== 'undefined' && navigator.webdriver === true) {
      gtag('set', 'traffic_type', 'internal');
    }
    gtag('config', '${measurementId}', { send_page_view: false });
  `;
}

export function sanitizeAnalyticsEventName(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_EVENT_NAME_LENGTH);

  return /^[a-z]/.test(sanitized) ? sanitized : `event_${sanitized || 'unknown'}`;
}

export function sanitizeAnalyticsParams(
  params: AnalyticsParams = {},
): Record<string, boolean | number | string> {
  const sanitized: Record<string, boolean | number | string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const sanitizedKey = sanitizeAnalyticsEventName(key);
    sanitized[sanitizedKey] =
      typeof value === 'string' ? value.slice(0, MAX_PARAM_VALUE_LENGTH) : value;
  }

  return sanitized;
}

export function trackAction(action: string, params: AnalyticsParams = {}): void {
  const measurementId = googleAnalyticsMeasurementId();
  if (!measurementId || typeof window === 'undefined' || typeof window.gtag !== 'function') return;

  const eventName = sanitizeAnalyticsEventName(action);
  window.gtag('event', eventName, {
    ...sanitizeAnalyticsParams(params),
    action: eventName,
  });
}

export function trackPageView(path: string, title?: string): void {
  const measurementId = googleAnalyticsMeasurementId();
  if (!measurementId || typeof window === 'undefined' || typeof window.gtag !== 'function') return;

  // GA4 defaults `page_location` to `window.location.href` (the full URL
  // including the query string). On a Firebase magic-link return, that
  // URL still carries `oobCode`/`apiKey`/`mode`/`continueUrl` until
  // completeEmailSignInLink consumes them — overriding page_location
  // with a sanitised `origin + path` keeps the auth tokens out of GA.
  // Stripping only page_path (which we already do at the caller) is
  // not enough: GA fills page_location independently.
  const pageLocation = `${window.location.origin}${path}`;

  window.gtag('config', measurementId, {
    page_path: path,
    page_location: pageLocation,
    page_title: title,
  });
}
