'use client';

import { cn } from '../lib/utils';

export interface StarterChipsProps {
  /** Suggested first-turn prompts. Rendered as pill-shaped chips. */
  prompts: readonly string[];
  /** Fired with the chip's text when the user picks one. */
  onSelect: (prompt: string) => void;
  /** When true, chips are visible but inert. */
  disabled?: boolean;
  className?: string;
}

/**
 * Vibey suggested prompts for an empty session — appear above the input
 * pill, designed to feel like soft invitations rather than menu items.
 *
 * Behavioural rules belong to the parent (ChatWindow): when to show them,
 * when to hide them after the first send, etc. This component is a pure
 * render + click forwarder.
 */
export function StarterChips({
  prompts,
  onSelect,
  disabled = false,
  className,
}: StarterChipsProps) {
  return (
    <fieldset className={cn('flex flex-wrap gap-2 border-0 p-0', className)}>
      <legend className="sr-only">Suggested prompts</legend>
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
          className={cn(
            'rounded-full border border-border bg-background/60 px-4 py-2 text-sm text-foreground/90 backdrop-blur-md transition-colors',
            'hover:border-accent/60 hover:bg-accent/10 hover:text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:border-accent focus-visible:outline-none',
          )}
        >
          {prompt}
        </button>
      ))}
    </fieldset>
  );
}
