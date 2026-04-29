'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

export interface SessionItem {
  sessionId: string;
  lastUpdateTime: number;
}

export interface SessionsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sorted by lastUpdateTime descending (the agent guarantees this). */
  sessions: SessionItem[];
  /** sessionId currently rendered in the chat area; highlighted in the list. */
  activeSessionId: string;
  /** sessionId for "today" — marked with a Today pill if it's in the list. */
  todaySessionId: string;
  /** Fired when the user picks a session. The drawer auto-closes. */
  onSelect: (sessionId: string) => void;
}

interface Group {
  label: string;
  items: SessionItem[];
}

/**
 * Slide-out drawer listing the user's previous chat sessions, grouped
 * Today / Yesterday / This Week / Earlier. Picking a non-today entry
 * is what flips ChatWindow into 'past' (view-only) mode — the drawer
 * itself only fires onSelect.
 */
export function SessionsDrawer({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  todaySessionId,
  onSelect,
}: SessionsDrawerProps) {
  const groups = groupSessions(sessions, todaySessionId);

  // Portal to <body> so the drawer never gets trapped inside an ancestor
  // that has backdrop-filter / transform / filter (any of which break
  // position: fixed for descendants).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Only render when open AND mounted (post-hydration). Skipping render
  // entirely when closed sidesteps stuck-open bugs from translate-x-full
  // on a non-fixed element.
  if (!open || !mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close sessions drawer"
        onClick={() => onOpenChange(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 30 }}
        className="bg-foreground/20 backdrop-blur-[1px]"
      />

      <aside
        style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 40,
          width: '18rem',
          maxWidth: '85vw',
        }}
        className={cn('flex flex-col border-r border-border bg-background shadow-2xl')}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Previous chats</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {groups.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No sessions yet.</p>
          ) : (
            groups.map((g) => (
              <section key={g.label} className="mb-3">
                <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </h3>
                <ul className="flex flex-col gap-0.5">
                  {g.items.map((s) => {
                    const date = parseSessionDate(s.sessionId);
                    const label = date ? formatItemDate(date) : s.sessionId;
                    const isActive = s.sessionId === activeSessionId;
                    const isToday = s.sessionId === todaySessionId;
                    return (
                      <li key={s.sessionId}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(s.sessionId);
                            onOpenChange(false);
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-full px-2 py-1.5 text-left text-sm transition-colors',
                            isActive
                              ? 'bg-accent/15 text-foreground'
                              : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="truncate">{label}</span>
                          {isToday ? (
                            <span className="shrink-0 rounded-full bg-success/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                              Today
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </nav>
      </aside>
    </>,
    document.body,
  );
}

/** Hamburger trigger button suitable for placing in the chat header. */
export function SessionsDrawerTrigger({
  onOpen,
  className,
}: {
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Open sessions"
      onClick={onOpen}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}

/**
 * Extract the trailing `YYYY-MM-DD` from a `${uid}-YYYY-MM-DD` sessionId.
 * Old (pre-migration) ids are random UUIDs and return null — those land
 * in the "Earlier" group with their raw id as the label.
 */
function parseSessionDate(sessionId: string): Date | null {
  const m = /-(\d{4})-(\d{2})-(\d{2})$/.exec(sessionId);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (!y || !mo || !d) return null;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function formatItemDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function groupSessions(sessions: SessionItem[], _todaySessionId: string): Group[] {
  if (sessions.length === 0) return [];
  const today = startOfLocalDay(new Date());

  const buckets: Record<string, SessionItem[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    Earlier: [],
  };

  for (const s of sessions) {
    const date = parseSessionDate(s.sessionId);
    if (!date) {
      buckets.Earlier?.push(s);
      continue;
    }
    const delta = daysBetween(date, today);
    if (delta <= 0) buckets.Today?.push(s);
    else if (delta === 1) buckets.Yesterday?.push(s);
    else if (delta < 7) buckets['This week']?.push(s);
    else buckets.Earlier?.push(s);
  }

  const ordered: Group[] = [];
  for (const label of ['Today', 'Yesterday', 'This week', 'Earlier']) {
    const items = buckets[label];
    if (items && items.length > 0) ordered.push({ label, items });
  }
  return ordered;
}
