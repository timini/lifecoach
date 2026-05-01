import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type * as React from 'react';
import { cn } from '../lib/utils';

const textVariants = cva('', {
  variants: {
    variant: {
      'serif-h1': 'font-serif text-3xl tracking-tight font-semibold leading-tight md:text-4xl',
      'serif-h2': 'font-serif text-2xl tracking-tight font-semibold leading-tight',
      'serif-h3': 'font-serif text-xl tracking-tight font-medium leading-snug',
      lead: 'text-base text-muted-foreground leading-relaxed',
      body: 'text-sm text-foreground leading-relaxed',
      caption: 'text-xs text-muted-foreground leading-normal',
      code: 'font-mono text-xs text-muted-foreground',
    },
    weight: {
      regular: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
    },
    tone: {
      foreground: 'text-foreground',
      muted: 'text-muted-foreground',
      accent: 'text-accent',
      destructive: 'text-destructive',
    },
  },
  defaultVariants: { variant: 'body' },
});

export interface TextProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'color'>,
    VariantProps<typeof textVariants> {
  asChild?: boolean;
  /**
   * Semantic HTML element to render. Defaults to a sensible match for the
   * variant (h1/h2/h3 for serif headings, p otherwise). Pass `as="span"` to
   * inline-flow.
   */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'div' | 'label';
}

const defaultElementByVariant: Record<string, TextProps['as']> = {
  'serif-h1': 'h1',
  'serif-h2': 'h2',
  'serif-h3': 'h3',
  lead: 'p',
  body: 'p',
  caption: 'p',
  code: 'span',
};

/**
 * Semantic typography primitive. Replaces hand-rolled `<h1 className="font-
 * serif tracking-tight…">` everywhere — same intent expressed once, varied
 * via `variant`. `weight` and `tone` are overrides for the rare moment a
 * variant doesn't quite fit.
 */
export const Text = forwardRef<HTMLElement, TextProps>(
  ({ className, variant, weight, tone, asChild, as, ...props }, ref) => {
    const Comp = (asChild ? Slot : (as ?? defaultElementByVariant[variant ?? 'body'] ?? 'p')) as
      | 'p'
      | typeof Slot;
    return (
      <Comp
        // biome-ignore lint/suspicious/noExplicitAny: forwardRef ref type narrows past element union
        ref={ref as any}
        className={cn(textVariants({ variant, weight, tone }), className)}
        {...props}
      />
    );
  },
);
Text.displayName = 'Text';

export { textVariants };
