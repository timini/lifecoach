import '@lifecoach/ui/styles.css';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { GoogleAnalytics } from '../components/GoogleAnalytics';
import { SentryBootstrap } from '../components/SentryBootstrap';

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifecoach.ai'),
  title: 'Lifecoach — the AI assistant that prevents overwhelm',
  description:
    'A warm AI assistant for ADHD, depression, burnout, anxiety, career, wellness, and daily admin when executive function is the bottleneck.',
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <head>
        {/* Web fonts loaded via <link> rather than CSS @import — Tailwind v4
            inlines its own @import directives into globals.css, which would
            push any url-import past the layered rules. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body className="bg-background text-foreground">
        <SentryBootstrap />
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
