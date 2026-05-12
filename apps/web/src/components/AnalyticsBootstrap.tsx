'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { type ReactNode, useEffect } from 'react';
import { googleAnalyticsMeasurementId, trackAction, trackPageView } from '../lib/analytics';

/**
 * Mounts Google Analytics once when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set,
 * tracks App Router page views, and forwards clicks from elements marked with
 * `data-analytics-event` as GA4 events.
 */
export function AnalyticsBootstrap(): ReactNode {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const measurementId = googleAnalyticsMeasurementId();
  const query = searchParams.toString();
  const path = query ? `${pathname}?${query}` : pathname;

  useEffect(() => {
    trackPageView(path, document.title);
  }, [path]);

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
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${measurementId}', { send_page_view: false });
        `}
      </Script>
    </>
  );
}
