import { cn } from '../lib/utils';

export interface BreathingPulseProps {
  /** Optional caption shown beneath the pulse — e.g. retry attempt count. */
  caption?: string;
  className?: string;
}

/**
 * Replaces the previous "thinking…" italic placeholder. A small sage circle
 * scales 0.85↔1.15 and fades 0.6↔1 over 2.4 seconds via the
 * `animate-breath` utility (defined inline below). `prefers-reduced-motion`
 * collapses to a static dot so users with motion sensitivity see something
 * stable.
 */
export function BreathingPulse({ caption, className }: BreathingPulseProps) {
  return (
    <output
      aria-live="polite"
      aria-label={caption ?? 'Thinking'}
      className={cn('flex flex-col items-start gap-1 self-start py-1', className)}
    >
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-full bg-accent animate-breath motion-reduce:animate-none"
      />
      {caption ? <span className="text-xs italic text-muted-foreground">{caption}</span> : null}
    </output>
  );
}
