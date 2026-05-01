'use client';

import { Button } from '../atoms/button';
import { cn } from '../lib/utils';

export interface UpgradePromptProps {
  /** Called when the user expresses interest — wire to checkout when billing lands. */
  onInterest: () => void;
  /** Disabled once the action has completed — history stays visible but inert. */
  disabled: boolean;
  className?: string;
}

export function UpgradePrompt({ onInterest, disabled, className }: UpgradePromptProps) {
  return (
    <div
      className={cn(
        'flex max-w-[90%] flex-col gap-3 self-start rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      <div className="text-sm font-semibold">Lifecoach Pro</div>
      <div className="text-xs text-muted-foreground">
        Faster replies, deeper analysis, no daily nudges. Pro launches soon — tap below and we'll
        email you when it's ready.
      </div>
      <Button
        type="button"
        size="md"
        onClick={onInterest}
        disabled={disabled}
        className="self-start"
      >
        I'm interested
      </Button>
    </div>
  );
}
