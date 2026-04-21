import type { ReactNode } from 'react';

export const metadata = {
  title: 'Lifecoach',
  description: 'AI life coaching — chat with a friend who remembers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#0f1419',
          color: '#e8e8e8',
        }}
      >
        {children}
      </body>
    </html>
  );
}
