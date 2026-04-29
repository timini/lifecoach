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
        'mx-auto flex min-h-[100dvh] max-w-[720px] flex-col gap-4 px-4 py-6',
        className,
      )}
    >
      <header className="sticky top-0 z-20 -mx-4 -mt-6 flex flex-col gap-1 bg-background/70 px-4 pt-6 pb-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/50">
        {header}
      </header>
      <section className="flex flex-1 flex-col gap-3 overflow-y-auto py-1">{children}</section>
      <footer className="mt-auto py-3">{footer}</footer>
    </main>
  );
}
