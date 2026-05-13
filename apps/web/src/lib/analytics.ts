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

  window.gtag('config', measurementId, {
    page_path: path,
    page_title: title,
  });
}
