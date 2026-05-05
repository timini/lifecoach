import { cn } from '../lib/utils';

export interface BubbleProps {
  /** Who sent this bubble. Renamed from `role` to avoid ARIA lint false-positives. */
  from: 'user' | 'assistant';
  children: React.ReactNode;
  className?: string;
  /**
   * Unix-ms timestamp. When provided, renders a muted time label under the
   * bubble (right-aligned for user, left-aligned for assistant). Use the
   * exported `formatBubbleTime` helper when you need the same string elsewhere.
   */
  timestamp?: number;
}

export function Bubble({ from, children, className, timestamp }: BubbleProps) {
  return (
    <div
      className={cn(
        'flex max-w-[84%] flex-col gap-0.5',
        from === 'user' ? 'self-end items-end' : 'self-start items-start',
      )}
    >
      <div
        data-from={from}
        className={cn(
          'whitespace-pre-wrap rounded-[var(--radius-bubble)] px-4 py-3 text-[15px] leading-relaxed shadow-sm',
          from === 'user'
            ? 'rounded-br-md bg-accent/90 text-accent-foreground'
            : 'border border-white/45 bg-white/35 text-foreground backdrop-blur-sm',
          className,
        )}
      >
        {children}
      </div>
      {typeof timestamp === 'number' ? (
        <time
          dateTime={new Date(timestamp).toISOString()}
          className="px-2 text-[10px] text-muted-foreground"
        >
          {formatBubbleTime(timestamp)}
        </time>
      ) : null}
    </div>
  );
}

/**
 * Format a Unix-ms timestamp for the bubble footer:
 *   - same day:  "2:34 PM"
 *   - this year: "Mar 5, 2:34 PM"
 *   - older:     "Mar 5, 2025"
 *
 * Locale-respecting (uses `toLocaleTimeString` / `toLocaleDateString`) and
 * tolerant of invalid inputs (returns empty string).
 */
export function formatBubbleTime(ts: number, now: Date = new Date()): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const sameYMD =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameYMD) return time;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${date}, ${time}`;
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
