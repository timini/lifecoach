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
      className={cn(
        'max-w-[80%] whitespace-pre-wrap rounded-[var(--radius-bubble)] px-3 py-2 text-[15px] leading-relaxed',
        from === 'user'
          ? 'self-end bg-accent text-accent-foreground'
          : 'self-start bg-muted text-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
