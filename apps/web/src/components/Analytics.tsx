'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useState } from 'react';
import {
  GA_MEASUREMENT_ID,
  analyticsParamsFromElement,
  isAnalyticsEnabled,
  trackAction,
  trackPageView,
} from '../lib/analytics';

export function Analytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const enabled = isAnalyticsEnabled();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || !ready) return;
    const query = searchParams.toString();
    trackPageView(query ? `${pathname}?${query}` : pathname);
  }, [enabled, pathname, ready, searchParams]);

  useEffect(() => {
    if (!enabled) return;

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const tracked = target.closest<HTMLElement>('[data-analytics-event]');
      if (!tracked) return;

      const action = tracked.dataset.analyticsEvent;
      if (!action) return;

      trackAction(action, {
        label: tracked.dataset.analyticsLabel ?? tracked.textContent?.trim(),
        href: tracked instanceof HTMLAnchorElement ? tracked.href : undefined,
        ...analyticsParamsFromElement(tracked),
      });
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive" onReady={() => setReady(true)}>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
        `}
      </Script>
    </>
  );
}
