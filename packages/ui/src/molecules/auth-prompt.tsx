'use client';

import { useState } from 'react';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { cn } from '../lib/utils';

export interface AuthPromptProps {
  mode: 'google' | 'email';
  /** Optional pre-filled email (if the model already knew it). */
  email?: string;
  /** Disabled once the user has acted; subsequent turns keep history visible but inert. */
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
        'flex max-w-[90%] flex-col gap-3 self-start rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      {mode === 'google' ? (
        <>
          <div className="text-sm font-semibold">Save your progress with Google</div>
          <div className="text-xs text-muted-foreground">
            Links this chat to your Google account so it follows you across devices.
          </div>
          <Button
            type="button"
            size="md"
            onClick={onGoogle}
            disabled={disabled}
            className="self-start"
          >
            Sign in with Google
          </Button>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold">Save your progress via email</div>
          <div className="text-xs text-muted-foreground">
            We'll send you a magic link. Click it to finish signing in.
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
