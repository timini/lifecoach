'use client';

import { useState } from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Input } from './input';

export interface AuthPromptProps {
  mode: 'google' | 'email';
  /** Optional pre-filled email (if the model already knew it). */
  email?: string;
  /** Disabled once the user has acted; subsequent turns keep the history visible but inert. */
  disabled: boolean;
  /** Called on Google button click. Implementer does the Firebase linkWithPopup. */
  onGoogle: () => void;
  /** Called on email-link submission. Implementer does the Firebase sendSignInLinkToEmail. */
  onEmail: (email: string) => void;
  className?: string;
}

export function AuthPrompt({
  mode,
  email: initialEmail,
  disabled,
  onGoogle,
  onEmail,
  className,
}: AuthPromptProps) {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [submitted, setSubmitted] = useState(false);

  return (
    <div
      className={cn(
        'flex max-w-[90%] flex-col gap-3 self-start rounded-2xl border border-border bg-background/40 p-4 backdrop-blur-md',
        className,
      )}
    >
      {mode === 'google' ? (
        <>
          <div className="text-sm font-semibold">Carry our conversation across devices</div>
          <div className="text-xs text-muted-foreground">
            Linking with Google lets this chat travel with you — same thread, any screen.
          </div>
          <Button
            type="button"
            size="md"
            onClick={onGoogle}
            disabled={disabled}
            className="self-start"
          >
            Continue with Google
          </Button>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold">Save your progress with email</div>
          <div className="text-xs text-muted-foreground">
            We'll send a magic link — open it once and you're in.
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.includes('@') || disabled) return;
              onEmail(email);
              setSubmitted(true);
            }}
          >
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled || submitted}
              className="flex-1"
            />
            <Button
              type="submit"
              size="md"
              disabled={disabled || submitted || !email.includes('@')}
            >
              {submitted ? 'Check email' : 'Send link'}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
