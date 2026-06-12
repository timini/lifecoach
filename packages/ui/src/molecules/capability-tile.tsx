'use client';

import { Button } from '../atoms/button';
import { cn } from '../lib/utils';

export type CapabilityId = 'workspace' | 'notion' | 'career_coaching';
export type CapabilityStatus = 'available' | 'connected' | 'coming_soon';
export type CapabilityCta = 'connect_workspace' | 'connect_notion';

export interface CapabilityTileProps {
  /** Stable identifier — used for analytics + drift tests. */
  id: CapabilityId;
  /** Human-facing tile heading. Coaching language, not engineering jargon. */
  title: string;
  /** One-line value-prop under the heading. */
  body: string;
  /**
   * Visual icon key. The renderer picks the asset to load by id rather
   * than a URL so the same payload works across dev/preview/prod
   * domains and SSR.
   */
  iconKey: 'workspace' | 'notion' | 'career';
  /** Connection state. Drives the button label + enabled-ness. */
  status: CapabilityStatus;
  /** The CTA the button fires. `null` for `coming_soon` tiles. */
  cta: CapabilityCta | null;
  /** Fired on Connect click with the cta value. Caller dispatches the actual flow. */
  onConnect?: (cta: CapabilityCta) => void;
  /** Whole-tile disabled (e.g. after Connect, before the flow returns). */
  disabled?: boolean;
  className?: string;
}

const ICON_GLYPH: Record<CapabilityTileProps['iconKey'], string> = {
  // Plain text glyphs keep the molecule asset-free until the
  // designer ships SVGs. Replace this map with an Image lookup once
  // packages/ui/src/assets/{workspace,notion,career}.svg exist.
  workspace: '✉',
  notion: '◐',
  career: '✦',
};

const BUTTON_LABEL: Record<CapabilityStatus, string> = {
  available: 'Connect',
  connected: 'Connected ✓',
  coming_soon: 'Coming soon',
};

export function CapabilityTile({
  id,
  title,
  body,
  iconKey,
  status,
  cta,
  onConnect,
  disabled = false,
  className,
}: CapabilityTileProps) {
  const isClickable = status === 'available' && cta !== null && !disabled;

  return (
    <div
      data-testid="capability-tile"
      data-id={id}
      data-status={status}
      className={cn(
        'flex min-w-[12rem] flex-1 flex-col gap-3 rounded-[var(--radius-bubble)] border border-border bg-muted p-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-full bg-foreground/5 text-base text-foreground"
        >
          {ICON_GLYPH[iconKey]}
        </span>
        <div className="flex flex-col">
          <div className="text-sm font-semibold leading-tight">{title}</div>
        </div>
      </div>
      <div className="flex-1 text-xs leading-relaxed text-muted-foreground">{body}</div>
      <Button
        type="button"
        size="sm"
        variant={status === 'connected' ? 'subtle' : 'primary'}
        disabled={!isClickable}
        onClick={() => {
          if (isClickable && cta !== null) onConnect?.(cta);
        }}
        className="self-start"
      >
        {BUTTON_LABEL[status]}
      </Button>
    </div>
  );
}
