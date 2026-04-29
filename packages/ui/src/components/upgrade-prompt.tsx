'use client';

import { cn } from '../lib/utils';
import { Button } from './button';

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
        'flex max-w-[90%] flex-col gap-3 self-start rounded-2xl border border-border bg-background/40 p-4 backdrop-blur-md',
        className,
      )}
    >
      <div className="text-sm font-semibold">Lifecoach Pro — deeper presence</div>
      <div className="text-xs text-muted-foreground">
        Faster replies, fuller memory, room for longer reflections. Pro is opening soon — tap and
        we'll let you know when it's ready.
      </div>
      <Button
        type="button"
        size="md"
        onClick={onInterest}
        disabled={disabled}
        className="self-start"
      >
        Keep me posted
      </Button>
    </div>
  );
}
