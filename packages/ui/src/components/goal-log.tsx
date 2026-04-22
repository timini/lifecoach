'use client';

import { cn } from '../lib/utils';

export type GoalLogStatus = 'started' | 'progress' | 'completed' | 'paused' | 'abandoned';

export interface GoalLogEntry {
  timestamp: string;
  goal: string;
  status: GoalLogStatus;
  note?: string;
}

export interface GoalLogProps {
  entries: readonly GoalLogEntry[];
}

const STATUS_TONE: Record<GoalLogStatus, string> = {
  started: 'bg-accent/20 text-accent-foreground border-accent/40',
  progress: 'bg-accent/20 text-accent-foreground border-accent/40',
  completed: 'bg-success/20 text-success border-success/40',
  paused: 'bg-muted text-muted-foreground border-border',
  abandoned: 'bg-destructive/20 text-destructive border-destructive/40',
};

function relative(isoTimestamp: string, now: Date = new Date()): string {
  const t = new Date(isoTimestamp).getTime();
  if (Number.isNaN(t)) return isoTimestamp;
  const diffMs = now.getTime() - t;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function GoalLog({ entries }: GoalLogProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-[var(--radius-control)] border border-dashed border-border p-4 text-xs text-muted-foreground">
        No goal updates yet. Tell the coach what you're working on.
      </div>
    );
  }
  const sorted = [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return (
    <ol className="flex flex-col gap-2">
      {sorted.map((e) => (
        <li
          key={`${e.timestamp}-${e.goal}`}
          className="flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-muted/40 p-3"
        >
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{e.goal}</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  STATUS_TONE[e.status],
                )}
              >
                {e.status}
              </span>
            </div>
            {e.note ? <span className="text-xs text-muted-foreground">{e.note}</span> : null}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground" title={e.timestamp}>
            {relative(e.timestamp)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export { relative as relativeTimestamp };
