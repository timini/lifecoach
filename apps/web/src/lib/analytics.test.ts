import { afterEach, describe, expect, it, vi } from 'vitest';

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window');
  } else {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

describe('analytics', () => {
  it('does nothing when GA is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');
    const gtag = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { gtag },
    });
    const { trackAction, trackPageView } = await import('./analytics');

    trackAction('chat_submit');
    trackPageView('/chat');

    expect(gtag).not.toHaveBeenCalled();
  });

  it('tracks page views and actions with normalized names', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { gtag },
    });
    const { trackAction, trackPageView } = await import('./analytics');

    trackPageView('/chat?from=test', 'Chat');
    trackAction('Chat Submit!', { source: 'composer', length: 12 });

    expect(gtag).toHaveBeenCalledWith('event', 'page_view', {
      page_path: '/chat?from=test',
      page_title: 'Chat',
    });
    expect(gtag).toHaveBeenCalledWith('event', 'chat_submit', {
      source: 'composer',
      length: 12,
    });
  });
});
