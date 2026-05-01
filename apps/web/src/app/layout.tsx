import '@lifecoach/ui/styles.css';
import type { ReactNode } from 'react';
import { SentryBootstrap } from '../components/SentryBootstrap';

export const metadata = {
  title: 'Lifecoach',
  description: 'AI life coaching — chat with a friend who remembers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
        {children}
      </body>
    </html>
  );
}
