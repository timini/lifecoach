import '@lifecoach/ui/styles.css';
import { Fraunces, Inter } from 'next/font/google';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Lifecoach',
  description: 'AI life coaching — chat with a friend who remembers.',
};

const fontSans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const fontSerif = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
  axes: ['opsz'],
});

// Inline pre-hydration script: read the user's saved theme (or system pref)
// and set data-theme on <html> BEFORE first paint. Without this, the page
// flashes the light default before React hydrates and reads localStorage.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('lifecoach.theme');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontSerif.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: required to set data-theme before first paint */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="bg-background text-foreground">{children}</body>
    </html>
  );
}
