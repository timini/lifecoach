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
      <body className="bg-background text-foreground">
        <SentryBootstrap />
        {children}
      </body>
    </html>
  );
}
