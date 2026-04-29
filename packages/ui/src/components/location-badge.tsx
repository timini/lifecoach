import { MapPin, MapPinOff } from 'lucide-react';
import { cn } from '../lib/utils';

export interface LocationBadgeProps {
  shared: boolean;
  requested: boolean;
  onShare: () => void;
}

/**
 * Compact icon-only header affordance for location sharing. Hover-tooltip
 * carries the verbose label so the icon stays clean.
 */
export function LocationBadge({ shared, requested, onShare }: LocationBadgeProps) {
  const label = shared ? 'Location shared' : requested ? 'Location unavailable' : 'Share location';
  const Icon = shared ? MapPin : MapPinOff;
  return (
    <button
      type="button"
      onClick={shared ? undefined : onShare}
      disabled={shared || requested}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors',
        shared ? 'text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        'disabled:cursor-default',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
