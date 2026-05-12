'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { type ReactNode, useEffect } from 'react';
import { GA_MEASUREMENT_ID, trackAction, trackPageView } from '../lib/analytics';

export function GoogleAnalytics(): ReactNode {
  const pathname = usePathname();

  useEffect(() => {
    if (!GA_MEASUREMENT_ID || !pathname) return;
    const query = window.location.search;
    trackPageView(`${pathname}${query}`, document.title);
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-analytics-action]')
          : null;
      const action = target?.dataset.analyticsAction;
      if (!target || !action) return;
      trackAction(action, {
        href: target instanceof HTMLAnchorElement ? target.getAttribute('href') : undefined,
        text: target.textContent?.trim().slice(0, 80),
      });
    }

    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);

  if (!GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
        `}
      </Script>
    </>
  );
}
