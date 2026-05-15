'use client';

import { cn } from '../lib/utils';
import {
  type CapabilityCta,
  type CapabilityId,
  type CapabilityStatus,
  CapabilityTile,
} from '../molecules/capability-tile';

export interface CapabilityPickerTile {
  id: CapabilityId;
  title: string;
  body: string;
  iconKey: 'workspace' | 'notion' | 'career';
  status: CapabilityStatus;
  cta: CapabilityCta | null;
}

export interface CapabilityPickerProps {
  /** Tiles to render. Order is preserved verbatim from the server. */
  tiles: CapabilityPickerTile[];
  /** Fired when a tile's Connect button is clicked. Caller dispatches. */
  onConnect: (cta: CapabilityCta) => void;
  /** Disabled once one tile has been acted on, until the flow returns. */
  disabled?: boolean;
  className?: string;
}

/**
 * Inline chat-rendered picker showing what the user can connect.
 *
 * Surfaced via the `show_capabilities` UI directive — proactively on
 * the first signed-in turn when no integrations are connected, and on
 * demand when the user asks "what can you do?".
 *
 * Layout: a 1-column stack on mobile, transitioning to 3 columns on
 * `sm:` and wider — tiles flex to equal heights so the bottom CTAs
 * line up.
 */
export function CapabilityPicker({
  tiles,
  onConnect,
  disabled = false,
  className,
}: CapabilityPickerProps) {
  return (
    <div
      data-testid="capability-picker"
      className={cn(
        'flex max-w-[95%] flex-col gap-3 self-start rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      <div className="text-sm font-semibold">Here's what I can connect to</div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {tiles.map((tile) => (
          <CapabilityTile
            key={tile.id}
            id={tile.id}
            title={tile.title}
            body={tile.body}
            iconKey={tile.iconKey}
            status={tile.status}
            cta={tile.cta}
            onConnect={onConnect}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
