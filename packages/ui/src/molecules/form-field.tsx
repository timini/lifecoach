'use client';

import { forwardRef, useId } from 'react';
import { Input, type InputProps } from '../atoms/input';
import { Label } from '../atoms/label';
import { cn } from '../lib/utils';

export interface FormFieldProps extends InputProps {
  /** Visible label associated with the input via htmlFor. */
  label: string;
  /** Optional helper or error text wired up via aria-describedby. */
  description?: string;
  /** When true, applies destructive styling to the description (still aria-describedby). */
  invalid?: boolean;
  containerClassName?: string;
}

/**
 * Label + Input + helper text composed once so callers don't re-wire htmlFor /
 * aria-describedby at every form site. Pass any Input prop through.
 */
export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, description, invalid, id, containerClassName, ...inputProps }: FormFieldProps, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const descId = description ? `${inputId}-desc` : undefined;
    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        <Label htmlFor={inputId}>{label}</Label>
        <Input id={inputId} ref={ref} aria-describedby={descId} {...inputProps} />
        {description ? (
          <span
            id={descId}
            className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
          >
            {description}
          </span>
        ) : null}
      </div>
    );
  },
);
FormField.displayName = 'FormField';
