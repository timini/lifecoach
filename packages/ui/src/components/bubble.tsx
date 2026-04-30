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
        'max-w-[80%] whitespace-pre-wrap rounded-[var(--radius-bubble)] px-3 py-2 text-[15px] leading-relaxed',
        from === 'user'
          ? 'self-end rounded-tr-md bg-accent/95 px-4 py-2.5 text-accent-foreground shadow-sm'
          : 'self-start max-w-[88%] bg-white/35 px-4 py-2.5 text-foreground backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}
