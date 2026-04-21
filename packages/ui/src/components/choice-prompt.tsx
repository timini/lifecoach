'use client';

import { useState } from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { RadioGroup, RadioGroupItem } from './radio-group';

export interface ChoicePromptProps {
  question: string;
  options: string[];
  single: boolean;
  disabled: boolean;
  onSubmit: (answer: string) => void;
  className?: string;
}

export function ChoicePrompt({
  question,
  options,
  single,
  disabled,
  onSubmit,
  className,
}: ChoicePromptProps) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  function toggle(opt: string) {
    if (disabled) return;
    setChosen((prev) => {
      if (single) return new Set([opt]);
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }

  function submit() {
    if (chosen.size === 0 || disabled) return;
    onSubmit(Array.from(chosen).join(', '));
  }

  return (
    <div
      className={cn(
        'flex max-w-[90%] flex-col gap-3 self-start rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      <div className="text-sm font-semibold">{question}</div>
      {single ? (
        <RadioGroup
          value={Array.from(chosen)[0] ?? ''}
          onValueChange={(v) => toggle(v)}
          disabled={disabled}
        >
          {options.map((opt) => {
            const id = `choice-${question}-${opt}`;
            return (
              <label
                key={opt}
                htmlFor={id}
                className={cn(
                  'flex items-center gap-2 text-sm',
                  disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
                )}
              >
                <RadioGroupItem id={id} value={opt} disabled={disabled} />
                {opt}
              </label>
            );
          })}
        </RadioGroup>
      ) : (
        <div className="flex flex-col gap-2">
          {options.map((opt) => {
            const id = `choice-${question}-${opt}`;
            const selected = chosen.has(opt);
            return (
              <label
                key={opt}
                htmlFor={id}
                className={cn(
                  'flex items-center gap-2 text-sm',
                  disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
                )}
              >
                <Checkbox
                  id={id}
                  checked={selected}
                  onCheckedChange={() => toggle(opt)}
                  disabled={disabled}
                />
                {opt}
              </label>
            );
          })}
        </div>
      )}
      <Button
        type="button"
        size="sm"
        onClick={submit}
        disabled={disabled || chosen.size === 0}
        className="self-start"
      >
        {single ? 'Select' : 'Submit'}
      </Button>
    </div>
  );
}
