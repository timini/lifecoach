export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '';

export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function isAnalyticsEnabled(measurementId = GA_MEASUREMENT_ID): boolean {
  return measurementId.trim().length > 0;
}

export function trackPageView(path: string, title?: string): void {
  if (!isAnalyticsEnabled() || typeof window === 'undefined' || typeof window.gtag !== 'function') {
    return;
  }

  window.gtag('config', GA_MEASUREMENT_ID, {
    page_path: path,
    page_title: title ?? document.title,
  });
}

export function trackAction(action: string, params: AnalyticsParams = {}): void {
  if (!isAnalyticsEnabled() || typeof window === 'undefined' || typeof window.gtag !== 'function') {
    return;
  }

  window.gtag('event', action, sanitizeParams(params));
}

export function analyticsParamsFromElement(element: HTMLElement): AnalyticsParams {
  const params: AnalyticsParams = {};

  for (const [key, value] of Object.entries(element.dataset)) {
    if (!key.startsWith('analyticsParam') || value === undefined) continue;
    const rawName = key.slice('analyticsParam'.length);
    const paramName = rawName.charAt(0).toLowerCase() + rawName.slice(1);
    if (!paramName) continue;
    params[toSnakeCase(paramName)] = value;
  }

  return params;
}

function sanitizeParams(params: AnalyticsParams): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== null && entry[1] !== undefined,
    ),
  );
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
