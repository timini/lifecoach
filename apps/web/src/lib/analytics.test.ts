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

  it('sends page view config updates when GA is available', () => {
    const gtag = vi.fn();
    vi.stubGlobal('window', { gtag });

    trackPageView('/chat?x=1', 'Chat');

    expect(gtag).toHaveBeenCalledWith('config', 'G-TEST', {
      page_path: '/chat?x=1',
      page_title: 'Chat',
    });

    vi.unstubAllGlobals();
  });
});
