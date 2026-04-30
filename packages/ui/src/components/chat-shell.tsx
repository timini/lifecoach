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
      <header className="sticky top-0 z-20 -mx-4 -mt-8 flex flex-col gap-2 border-b border-border/70 bg-background/70 px-4 pt-7 pb-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        {header}
      </header>
      <section className="flex flex-1 flex-col gap-4 overflow-y-auto py-2">{children}</section>
      <footer>{footer}</footer>
    </main>
  );
}
