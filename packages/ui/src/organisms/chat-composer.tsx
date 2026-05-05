'use client';

import type * as React from 'react';
import { useState } from 'react';
import { IconButton } from '../atoms/icon-button';
import { Input } from '../atoms/input';
import { cn } from '../lib/utils';

export interface ChatComposerProps {
  /** Submitted text — caller resets state via `value` if it cares to. */
  onSubmit: (text: string) => void;
  /** Disables typing and submit (e.g., while a turn is in flight). */
  disabled?: boolean;
  placeholder?: string;
  /** Accessible label for the send button. */
  sendLabel?: string;
  className?: string;
  /** Optional controlled value; otherwise the composer manages its own input state. */
  value?: string;
  onChange?: (next: string) => void;
}

/**
 * Pill-shaped chat composer: text input + round send button. Clears the
 * input on submit (uncontrolled mode) or just calls `onChange('')`
 * (controlled mode). Empty / whitespace-only submissions are dropped.
 */
export function ChatComposer({
  onSubmit,
  disabled = false,
  placeholder = 'Message…',
  sendLabel = 'Send',
  className,
  value,
  onChange,
}: ChatComposerProps) {
  const [internal, setInternal] = useState('');
  const isControlled = value !== undefined;
  const text = isControlled ? (value as string) : internal;

  function setText(next: string) {
    if (isControlled) {
      onChange?.(next);
    } else {
      setInternal(next);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex gap-2 rounded-full border border-border/70 bg-background/70 p-1.5 shadow-sm backdrop-blur-md',
        className,
      )}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 border-0 bg-transparent shadow-none focus-visible:border-transparent"
      />
      <IconButton
        type="submit"
        variant="solid"
        size="md"
        disabled={disabled || !text.trim()}
        aria-label={sendLabel}
      >
        <SendIcon />
      </IconButton>
    </form>
  );
}

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
