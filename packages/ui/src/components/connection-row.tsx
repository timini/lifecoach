'use client';

import type * as React from 'react';
import { cn } from '../lib/utils';

export type ConnectionTone = 'muted' | 'accent' | 'success' | 'warn';

export interface ConnectionRowProps {
  icon: React.ReactNode;
  label: string;
  status: string;
  statusTone?: ConnectionTone;
  action?: React.ReactNode;
}

const TONE: Record<ConnectionTone, string> = {
  muted: 'text-muted-foreground',
  accent: 'text-accent-foreground',
  success: 'text-success',
  warn: 'text-destructive',
};

export function ConnectionRow({
  icon,
  label,
  status,
  statusTone = 'muted',
  action,
}: ConnectionRowProps) {
  return (
    <div className="flex min-h-[64px] items-center gap-4 rounded-2xl border border-border bg-muted/40 px-4 py-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className={cn('text-xs', TONE[statusTone])}>{status}</span>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
