import { cn } from '../lib/utils';

export interface BubbleProps {
  /** Who sent this bubble. Renamed from `role` to avoid ARIA lint false-positives. */
  from: 'user' | 'assistant';
  children: React.ReactNode;
  className?: string;
}

export function Bubble({ from, children, className }: BubbleProps) {
  return (
    <div
      data-from={from}
      className={cn(
        'max-w-[82%] whitespace-pre-wrap rounded-[var(--radius-bubble)] px-4 py-2.5 text-[15px] leading-7',
        from === 'user'
          ? 'self-end rounded-br-md bg-accent text-accent-foreground shadow-sm'
          : 'self-start border border-white/45 bg-background/40 text-foreground backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}
