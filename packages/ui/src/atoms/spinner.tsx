import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type * as React from 'react';
import { cn } from '../lib/utils';

const spinnerVariants = cva(
  'inline-block rounded-full animate-spin border-current border-t-transparent',
  {
    variants: {
      size: {
        xs: 'h-3 w-3 border-[1.5px]',
        sm: 'h-4 w-4 border-2',
        md: 'h-5 w-5 border-2',
        lg: 'h-8 w-8 border-[3px]',
      },
      tone: {
        accent: 'text-accent',
        muted: 'text-muted-foreground',
        current: 'text-current',
      },
    },
    defaultVariants: { size: 'sm', tone: 'accent' },
  },
);

export interface SpinnerProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof spinnerVariants> {
  /** Screen-reader text describing what's loading. Defaults to "Loading". */
  label?: string;
}

/**
 * Loading indicator. Uses a standard `border-spin` Tailwind animation
 * (already shipped with Tailwind v4 base) — no custom keyframe needed.
 * The visual is decorative; the `label` prop is the accessible name.
 */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ className, size, tone, label = 'Loading', ...props }, ref) => (
    <span
      ref={ref}
      role="status"
      aria-label={label}
      className={cn(spinnerVariants({ size, tone }), className)}
      {...props}
    />
  ),
);
Spinner.displayName = 'Spinner';

export { spinnerVariants };
