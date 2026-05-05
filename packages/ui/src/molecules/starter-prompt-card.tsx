'use client';

import { Button } from '../atoms/button';
import { cn } from '../lib/utils';

export interface StarterPromptCardProps {
  /** Short label rendered as the card body — should fit on one line. */
  prompt: string;
  /** Called with the prompt text when the user picks the card. */
  onSelect: (prompt: string) => void;
  className?: string;
}

/**
 * Tap-to-fill card surfaced when the chat is empty. Renders as a Button under
 * the hood so keyboard / a11y semantics ride for free.
 */
export function StarterPromptCard({ prompt, onSelect, className }: StarterPromptCardProps) {
  return (
    <Button
      type="button"
      variant="subtle"
      size="md"
      onClick={() => onSelect(prompt)}
      className={cn('h-auto whitespace-normal text-left text-sm leading-snug', className)}
    >
      {prompt}
    </Button>
  );
}
