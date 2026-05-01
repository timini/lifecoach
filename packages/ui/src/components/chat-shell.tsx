import type * as React from 'react';
import { cn } from '../lib/utils';

export interface ChatShellProps {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ChatShell({ header, footer, children, className }: ChatShellProps) {
  return (
    <main
      className={cn(
        'mx-auto flex min-h-[100dvh] max-w-[760px] flex-col gap-5 px-4 py-8',
        className,
      )}
    >
      <header className="sticky top-0 z-20 -mx-4 -mt-6 flex flex-col gap-1 border-b border-border bg-background/95 px-4 pt-6 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {header}
      </header>
      <section className="flex flex-1 flex-col gap-4 overflow-y-auto py-2 pb-28">
        {children}
      </section>
      <footer>{footer}</footer>
    </main>
  );
}
