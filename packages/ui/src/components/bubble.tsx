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
        'max-w-[84%] whitespace-pre-wrap rounded-[var(--radius-bubble)] px-4 py-3 text-[15px] leading-relaxed shadow-sm',
        from === 'user'
          ? 'self-end rounded-br-md bg-accent/90 text-accent-foreground'
          : 'self-start border border-white/45 bg-white/35 text-foreground backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}
