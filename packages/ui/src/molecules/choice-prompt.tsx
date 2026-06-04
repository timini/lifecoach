'use client';

import { useId, useState } from 'react';
import { Button } from '../atoms/button';
import { Checkbox } from '../atoms/checkbox';
import { RadioGroup, RadioGroupItem } from '../atoms/radio-group';
import { cn } from '../lib/utils';
import { Markdown } from '../organisms/markdown';

export interface ChoicePromptProps {
  question: string;
  options: string[];
  single: boolean;
  disabled: boolean;
  onSubmit: (answer: string) => void;
  className?: string;
}

/**
 * Markdown collapses a single newline into a space, so a multi-line prompt
 * (e.g. the triage archive digest the agent sends as "Archive 7?\n• a\n• b…")
 * would otherwise render as one run-on blob. Convert each newline into a
 * Markdown hard break so the lines actually stack. `<br>` is in the inline
 * allow-list, so this works in the compact label renderer.
 */
function withLineBreaks(markdown: string): string {
  return markdown.replace(/\n/g, '  \n');
}

export function ChoicePrompt({
  question,
  options,
  single,
  disabled,
  onSubmit,
  className,
}: ChoicePromptProps) {
  const idPrefix = useId();
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
      data-testid="choice-prompt"
      className={cn(
        'flex max-w-[90%] flex-col gap-3 self-start rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      <Markdown inline className="text-sm font-semibold">
        {withLineBreaks(question)}
      </Markdown>
      {single ? (
        <RadioGroup
          value={Array.from(chosen)[0] ?? ''}
          onValueChange={(v) => toggle(v)}
          disabled={disabled}
        >
          {options.map((opt, index) => {
            const id = `${idPrefix}-choice-${index}`;
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
                <Markdown inline className="min-w-0 flex-1">
                  {opt}
                </Markdown>
              </label>
            );
          })}
        </RadioGroup>
      ) : (
        <div className="flex flex-col gap-2">
          {options.map((opt, index) => {
            const id = `${idPrefix}-choice-${index}`;
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
                <Markdown inline className="min-w-0 flex-1">
                  {opt}
                </Markdown>
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
