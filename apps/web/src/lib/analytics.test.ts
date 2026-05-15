import { describe, expect, it, vi } from 'vitest';
import {
  buildAnalyticsBootstrapScript,
  googleAnalyticsMeasurementId,
  isInternalTraffic,
  sanitizeAnalyticsEventName,
  sanitizeAnalyticsParams,
  trackAction,
  trackPageView,
} from './analytics';

describe('analytics', () => {
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST';
  it('reads the configured GA measurement id', () => {
    expect(googleAnalyticsMeasurementId()).toBe('G-TEST');
  });

  it('sanitizes action names for GA4 event names', () => {
    expect(sanitizeAnalyticsEventName('Sessions.Drawer Opened!')).toBe('sessions_drawer_opened');
    expect(sanitizeAnalyticsEventName('123')).toBe('event_123');
    expect(sanitizeAnalyticsEventName('')).toBe('event_unknown');
  });

  it('keeps only GA-safe primitive event params', () => {
    expect(
      sanitizeAnalyticsParams({
        'View Mode': 'live',
        count: 3,
        open: true,
        skipped: null,
        alsoSkipped: undefined,
      }),
    ).toEqual({ view_mode: 'live', count: 3, open: true });
  });

  it('sends sanitized action events when GA is available', () => {
    const gtag = vi.fn();
    vi.stubGlobal('window', { gtag });

    trackAction('Chat.Message Sent', { source: 'composer', length: 42 });

    expect(gtag).toHaveBeenCalledWith('event', 'chat_message_sent', {
      source: 'composer',
      length: 42,
      action: 'chat_message_sent',
    });

    vi.unstubAllGlobals();
  });

  it('sends page view config updates when GA is available, with sanitised page_location', () => {
    // GA4 would otherwise fill page_location from window.location.href.
    // Override it explicitly with origin + path so magic-link query
    // tokens never reach Google. The path we receive is already query-
    // stripped at the caller (GoogleAnalytics.tsx); page_location is
    // built from window.location.origin + that path.
    const gtag = vi.fn();
    vi.stubGlobal('window', {
      gtag,
      location: { origin: 'https://lifecoach.app', href: 'unused' },
    });

    trackPageView('/chat', 'Chat');

    expect(gtag).toHaveBeenCalledWith('config', 'G-TEST', {
      page_path: '/chat',
      page_location: 'https://lifecoach.app/chat',
      page_title: 'Chat',
    });

    vi.unstubAllGlobals();
  });

  describe('isInternalTraffic', () => {
    it('returns true when navigator.webdriver is true (Playwright/WebDriver)', () => {
      vi.stubGlobal('navigator', { webdriver: true });
      expect(isInternalTraffic()).toBe(true);
      vi.unstubAllGlobals();
    });

    it('returns false when navigator.webdriver is false (real browser)', () => {
      vi.stubGlobal('navigator', { webdriver: false });
      expect(isInternalTraffic()).toBe(false);
      vi.unstubAllGlobals();
    });

    it('returns false when navigator is undefined (SSR)', () => {
      vi.stubGlobal('navigator', undefined);
      expect(isInternalTraffic()).toBe(false);
      vi.unstubAllGlobals();
    });
  });

  describe('buildAnalyticsBootstrapScript', () => {
    it('inlines the measurement id and disables auto page_view', () => {
      const script = buildAnalyticsBootstrapScript('G-TEST');
      expect(script).toContain("gtag('config', 'G-TEST', { send_page_view: false })");
    });

    it('tags WebDriver sessions as internal traffic so e2e runs are filtered in GA', () => {
      const script = buildAnalyticsBootstrapScript('G-TEST');
      // Both the guarded check and the resulting `set` call must be present
      // so the GA admin "Internal Traffic" data filter can exclude these
      // events without us touching every Playwright spec.
      expect(script).toContain('navigator.webdriver');
      expect(script).toContain("gtag('set', 'traffic_type', 'internal')");
    });

    it('produces executable JS that calls gtag with internal traffic when webdriver=true', () => {
      const calls: unknown[][] = [];
      const sandbox = {
        navigator: { webdriver: true },
        dataLayer: undefined as unknown[] | undefined,
        gtag: undefined as ((...args: unknown[]) => void) | undefined,
      };
      // Run the bootstrap as if it were the inline <script>. `window` aliases
      // sandbox via `with`-like binding through a Function call site.
      new Function(
        'window',
        'navigator',
        `with(window){${buildAnalyticsBootstrapScript('G-TEST')}}`,
      )(sandbox, sandbox.navigator);
      // After bootstrap, gtag is wired up and dataLayer captured the calls.
      expect(sandbox.dataLayer).toBeDefined();
      const args = (sandbox.dataLayer as unknown[]).map((entry) => Array.from(entry as unknown[]));
      // We expect: ['js', Date], ['set', 'traffic_type', 'internal'], ['config', 'G-TEST', {...}]
      expect(args).toContainEqual(['set', 'traffic_type', 'internal']);
      expect(args.some((a) => a[0] === 'config' && a[1] === 'G-TEST')).toBe(true);
      calls.push(...args);
    });

    it('omits the internal-traffic tag when webdriver=false', () => {
      const sandbox = {
        navigator: { webdriver: false },
        dataLayer: undefined as unknown[] | undefined,
        gtag: undefined as ((...args: unknown[]) => void) | undefined,
      };
      new Function(
        'window',
        'navigator',
        `with(window){${buildAnalyticsBootstrapScript('G-TEST')}}`,
      )(sandbox, sandbox.navigator);
      const args = (sandbox.dataLayer as unknown[]).map((entry) => Array.from(entry as unknown[]));
      expect(args.some((a) => a[0] === 'set' && a[1] === 'traffic_type')).toBe(false);
    });
  });
});
