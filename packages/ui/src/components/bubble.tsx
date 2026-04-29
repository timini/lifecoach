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
        'max-w-[80%] whitespace-pre-wrap px-4 py-3 text-[15px] leading-relaxed',
        from === 'user'
          ? 'self-end rounded-[24px] rounded-tr-[6px] bg-accent text-accent-foreground shadow-sm'
          : 'self-start rounded-[24px] rounded-tl-[6px] border border-foreground/5 bg-background/40 text-foreground backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}
