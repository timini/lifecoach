import { describe, expect, it, vi } from 'vitest';
import {
  googleAnalyticsMeasurementId,
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
});
