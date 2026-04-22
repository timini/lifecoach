'use client';

import { cn } from '../lib/utils';
import { Button } from './button';

export interface WorkspacePromptProps {
  /** Called when the user clicks Connect — implementer runs the GIS popup. */
  onConnect: () => void;
  /** Disabled once the action has completed — history stays visible but inert. */
  disabled: boolean;
  className?: string;
}

export function WorkspacePrompt({ onConnect, disabled, className }: WorkspacePromptProps) {
  return (
    <div
      className={cn(
        'flex max-w-[90%] flex-col gap-3 self-start rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      <div className="text-sm font-semibold">Connect Google Workspace</div>
      <div className="text-xs text-muted-foreground">
        Grant access to Gmail, Calendar, and Tasks so I can help with email triage, calendar
        management, and your task list. You can revoke any time in Settings.
      </div>
      <Button
        type="button"
        size="md"
        onClick={onConnect}
        disabled={disabled}
        className="self-start"
      >
        Connect Workspace
      </Button>
    </div>
  );
}
