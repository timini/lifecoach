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
        'max-w-[82%] whitespace-pre-wrap rounded-[var(--radius-bubble)] px-4 py-3 text-[15px] leading-7 shadow-sm',
        from === 'user'
          ? 'self-end rounded-br-md bg-accent/90 text-accent-foreground'
          : 'self-start rounded-bl-md border border-white/40 bg-background/35 text-foreground backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}
