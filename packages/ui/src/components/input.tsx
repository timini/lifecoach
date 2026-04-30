import { forwardRef } from 'react';
import type * as React from 'react';
import { cn } from '../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-12 w-full rounded-[var(--radius-control)] border border-border/70 bg-background/90 px-5 py-2 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 backdrop-blur',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
