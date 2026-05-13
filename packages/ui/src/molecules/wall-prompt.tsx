'use client';

import { Button } from '../atoms/button';
import { cn } from '../lib/utils';

export type WallReason = 'free_limit' | 'free_signed_in_limit';
export type WallCta = 'auth_user' | 'upgrade_to_pro';

export interface WallPromptProps {
  /** Which wall the user hit. Drives the copy. */
  reason: WallReason;
  /** Which CTA the button fires. Drives the click handler dispatch. */
  cta: WallCta;
  /** Called when the user clicks the CTA, when cta === 'auth_user'. */
  onAuthUser?: () => void;
  /** Called when the user clicks the CTA, when cta === 'upgrade_to_pro'. */
  onUpgradeToPro?: () => void;
  /** Disabled once the user has acted — history stays visible but inert. */
  disabled?: boolean;
  className?: string;
}

// Copy intentionally warm — the wall fires at the end of a long day's
// worth of chats, often when the user has already said "I need to go to
// bed." A corporate "Upgrade to Pro to continue" lands like a slammed
// door; "let's pick this up tomorrow" lands like a coach.
const COPY: Record<WallReason, { title: string; body: string }> = {
  free_limit: {
    title: "We've had a good run today",
    body: "I'll be here tomorrow — your daily chats refresh overnight. If you want what we talked about to stick around between sessions, sign in and we'll carry it forward.",
  },
  free_signed_in_limit: {
    title: "Let's pick this up tomorrow",
    body: "You've had a thorough day with me already — your daily chats refresh overnight, so I'll be ready when you are. If you'd like to keep going now (or remove the daily cap for good), Pro is the way.",
  },
};

const CTA_LABEL: Record<WallCta, string> = {
  auth_user: 'Sign in to save progress',
  upgrade_to_pro: 'Tell me about Pro',
};

export function WallPrompt({
  reason,
  cta,
  onAuthUser,
  onUpgradeToPro,
  disabled = false,
  className,
}: WallPromptProps) {
  const copy = COPY[reason];
  const onClick = cta === 'auth_user' ? onAuthUser : onUpgradeToPro;
  return (
    <div
      data-testid="wall-prompt"
      data-reason={reason}
      data-cta={cta}
      className={cn(
        'flex max-w-[90%] flex-col gap-3 self-start rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      <div className="text-sm font-semibold">{copy.title}</div>
      <div className="text-xs text-muted-foreground">{copy.body}</div>
      <Button
        type="button"
        size="md"
        onClick={onClick}
        disabled={disabled || onClick === undefined}
        className="self-start"
      >
        {CTA_LABEL[cta]}
      </Button>
    </div>
  );
}
