'use client';

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsParams = Record<string, AnalyticsValue>;
type GtagCommand = 'config' | 'event' | 'js' | 'set';
type GtagArguments =
  | [GtagCommand, string | Date, AnalyticsParams?]
  | [GtagCommand, AnalyticsParams];

declare global {
  interface Window {
    dataLayer?: GtagArguments[];
    gtag?: (...args: GtagArguments) => void;
  }
}

export function isAnalyticsEnabled(): boolean {
  return Boolean(GA_MEASUREMENT_ID);
}

export function trackPageView(path: string, title?: string): void {
  const gtag = getGtag();
  if (!gtag) return;
  gtag('event', 'page_view', {
    page_path: path,
    page_title: title,
  });
}

export function trackAction(action: string, params: AnalyticsParams = {}): void {
  const gtag = getGtag();
  if (!gtag) return;
  gtag('event', normalizeEventName(action), params);
}

function getGtag(): NonNullable<Window['gtag']> | null {
  if (typeof window === 'undefined' || !GA_MEASUREMENT_ID || typeof window.gtag !== 'function') {
    return null;
  }
  return window.gtag;
}

function normalizeEventName(action: string): string {
  const normalized = action
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return normalized || 'action';
}
