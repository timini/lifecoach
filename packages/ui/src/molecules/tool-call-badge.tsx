'use client';

import { Check, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ToolCallBadgeProps {
  label: string;
  done: boolean;
  ok?: boolean;
  className?: string;
}

/**
 * Inline pill that surfaces what the coach is doing while it runs a tool.
 * Spinner while `done === false`; a check (ok) or cross (error) afterwards.
 */
export function ToolCallBadge({ label, done, ok, className }: ToolCallBadgeProps) {
  const Icon = !done ? Loader2 : ok ? Check : X;
  const tone = !done ? 'text-muted-foreground' : ok ? 'text-success' : 'text-destructive';
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 self-start rounded-full border border-border bg-muted/50 px-3 py-1 text-xs',
        done && ok === false && 'border-destructive/40',
        className,
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', !done && 'animate-spin', tone)} />
      <span className={cn('truncate', done ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  );
}
