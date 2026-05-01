import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type * as React from 'react';
import { cn } from '../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted/40 text-muted-foreground',
        accent: 'border-accent/40 bg-accent/10 text-foreground',
        success: 'border-success/40 bg-success/10 text-foreground',
        warn: 'border-destructive/30 bg-destructive/10 text-foreground',
        outline: 'border-border bg-transparent text-muted-foreground',
      },
      size: {
        sm: 'px-2 py-0 text-[10px]',
        md: 'px-2.5 py-0.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * Inline status / category pill — used by LocationBadge, ToolCallBadge,
 * connection rows, settings "Coming soon" markers, etc. Tone names map to
 * design intent ("success", "warn") rather than colour ("green", "red") so
 * the palette can shift without renaming callsites.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone, size }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
