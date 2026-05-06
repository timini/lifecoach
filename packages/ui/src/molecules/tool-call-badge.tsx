'use client';

import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';

export interface ToolCallBadgeProps {
  label: string;
  done: boolean;
  ok?: boolean;
  className?: string;
  /** Raw args from functionCall. When provided alongside response (or
   * either alone), the badge becomes a clickable button that expands to
   * show args + response as JSON — useful for debugging what the agent
   * actually did. */
  args?: unknown;
  /** Raw response from functionResponse. */
  response?: unknown;
}

/**
 * Inline pill that surfaces what the coach is doing while it runs a tool.
 * Spinner while `done === false`; a check (ok) or cross (error) afterwards.
 *
 * When the caller passes args or response, the pill becomes a button: a
 * chevron appears, click toggles a small JSON panel below the pill that
 * shows what was called with what, and what came back. Useful for
 * debugging when the model surprises you.
 */
export function ToolCallBadge({ label, done, ok, className, args, response }: ToolCallBadgeProps) {
  const Icon = !done ? Loader2 : ok ? Check : X;
  const tone = !done ? 'text-muted-foreground' : ok ? 'text-success' : 'text-destructive';
  const expandable = args !== undefined || response !== undefined;
  const [open, setOpen] = useState(false);

  const pill = (
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
      {expandable ? (
        open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )
      ) : null}
    </div>
  );

  if (!expandable) return pill;

  return (
    <div className="flex flex-col gap-1 self-start">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start text-left transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
      >
        {pill}
      </button>
      {open ? (
        <div className="ml-3 max-w-[min(560px,90vw)] overflow-x-auto rounded-md border border-border/60 bg-background/60 p-2 text-[11px]">
          {args !== undefined ? (
            <div className="mb-1.5">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                args
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono leading-snug text-foreground">
                {formatJson(args)}
              </pre>
            </div>
          ) : null}
          {response !== undefined ? (
            <div>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                response
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono leading-snug text-foreground">
                {formatJson(response)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
