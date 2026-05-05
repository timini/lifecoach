import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type * as React from 'react';
import { cn } from '../lib/utils';

const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-full border-transparent text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'bg-transparent hover:bg-muted/60 hover:text-foreground',
        solid: 'bg-accent text-accent-foreground hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-muted/40 hover:text-foreground',
      },
      size: {
        sm: 'h-8 w-8 [&>svg]:h-4 [&>svg]:w-4',
        md: 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5',
        lg: 'h-12 w-12 [&>svg]:h-6 [&>svg]:w-6',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
  /** Required — the visible label is the icon, so the button needs an a11y name. */
  'aria-label': string;
}

/**
 * Round/square icon-only button. Used for ChatComposer's send action,
 * SessionsDrawer toggle, and any other compact-action surface where the
 * icon is the affordance.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(iconButtonVariants({ variant, size }), className)} {...props} />
    );
  },
);
IconButton.displayName = 'IconButton';

export { iconButtonVariants };
