'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { type ReactNode, useEffect } from 'react';
import {
  buildAnalyticsBootstrapScript,
  googleAnalyticsMeasurementId,
  trackAction,
  trackPageView,
} from '../lib/analytics';

/**
 * Mounts Google Analytics once when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set,
 * tracks App Router page views, and forwards clicks from elements marked
 * with `data-analytics-event` as GA4 events.
 *
 * page_path = the bare pathname. Query strings are deliberately STRIPPED
 * before reporting so we never ship Firebase magic-link tokens
 * (`oobCode`, `apiKey`, `mode`, `continueUrl`) — which arrive on the URL
 * when a user returns via `completeEmailSignInLink(window.location.href)`
 * — to Google Analytics. UTM / campaign attribution is captured by GA4
 * via the landing referrer, not page_path, so we don't lose that signal.
 */
export function GoogleAnalytics(): ReactNode {
  const pathname = usePathname();
  const measurementId = googleAnalyticsMeasurementId();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    trackPageView(pathname, document.title);
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const tracked = event.target.closest<HTMLElement>('[data-analytics-event]');
      if (!tracked) return;

      trackAction(tracked.dataset.analyticsEvent ?? 'click', {
        label: tracked.dataset.analyticsLabel,
        href: tracked instanceof HTMLAnchorElement ? tracked.href : undefined,
      });
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!measurementId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {buildAnalyticsBootstrapScript(measurementId)}
      </Script>
    </>
  );
}
