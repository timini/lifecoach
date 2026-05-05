import { forwardRef } from 'react';
import type * as React from 'react';
import { cn } from '../lib/utils';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

/**
 * Form label primitive — pairs with `Input` / `Checkbox` / `RadioGroup` via
 * `htmlFor` (or via a wrapping element). Kept as a thin atom so molecules
 * like `FormField` can compose it without re-styling at every callsite.
 */
export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: callers wire htmlFor; primitive can't statically know its target
  <label
    ref={ref}
    className={cn(
      'text-sm font-medium text-foreground leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';
