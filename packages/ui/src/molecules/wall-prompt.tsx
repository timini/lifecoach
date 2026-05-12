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

const COPY: Record<WallReason, { title: string; body: string }> = {
  free_limit: {
    title: "You've reached the free chat limit",
    body: 'Sign in with Google to keep chatting — your progress carries across to the signed-in tier and the better model.',
  },
  free_signed_in_limit: {
    title: "You've reached the free chat limit",
    body: 'Pro removes the chat cap and unlocks faster, deeper coaching. Pro launches soon — tap below and we will email you when it is ready.',
  },
};

const CTA_LABEL: Record<WallCta, string> = {
  auth_user: 'Sign in with Google',
  upgrade_to_pro: "I'm interested in Pro",
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
