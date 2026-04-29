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
        'flex max-w-[90%] flex-col gap-3 self-start rounded-2xl border border-border bg-background/40 p-4 backdrop-blur-md',
        className,
      )}
    >
      <div className="text-sm font-semibold">Bring your calendar and inbox into the room</div>
      <div className="text-xs text-muted-foreground">
        Connect Google Workspace and I can help with mail, your week's schedule, and what's on your
        task list. You can disconnect any time from Settings.
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
