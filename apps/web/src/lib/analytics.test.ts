import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyticsParamsFromElement,
  isAnalyticsEnabled,
  trackAction,
  trackPageView,
} from './analytics';

describe('analytics helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only enables analytics when a measurement id is configured', () => {
    expect(isAnalyticsEnabled('')).toBe(false);
    expect(isAnalyticsEnabled('   ')).toBe(false);
    expect(isAnalyticsEnabled('G-ABC123')).toBe(true);
  });

  it('converts data analytics params to snake_case event params', () => {
    const element = {
      dataset: {
        analyticsParamLocation: 'hero',
        analyticsParamExperimentId: 'onboarding-v2',
        analyticsEvent: 'cta_click',
      },
    } as unknown as HTMLElement;

    expect(analyticsParamsFromElement(element)).toEqual({
      location: 'hero',
      experiment_id: 'onboarding-v2',
    });
  });

  it('does not send actions or page views before gtag is available', () => {
    vi.stubGlobal('window', {});

    expect(() => trackAction('cta_click', { label: 'hero' })).not.toThrow();
    expect(() => trackPageView('/chat')).not.toThrow();
  });
});
