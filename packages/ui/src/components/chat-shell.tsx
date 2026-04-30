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
        'mx-auto flex min-h-[100dvh] max-w-[760px] flex-col gap-4 px-4 py-8',
        className,
      )}
    >
      <header className="sticky top-2 z-20 flex flex-col gap-1 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 shadow-sm backdrop-blur-md">
        {header}
      </header>
      <section className="flex flex-1 flex-col gap-3 overflow-y-auto py-1">{children}</section>
      <footer>{footer}</footer>
    </main>
  );
}
