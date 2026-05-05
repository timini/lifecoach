import { MapPin } from 'lucide-react';
import { Button } from '../atoms/button';

export interface LocationBadgeProps {
  shared: boolean;
  requested: boolean;
  onShare: () => void;
}

export function LocationBadge({ shared, requested, onShare }: LocationBadgeProps) {
  if (shared) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <MapPin className="h-3.5 w-3.5" />
        location shared
      </span>
    );
  }
  return (
    <Button variant="subtle" size="sm" onClick={onShare} disabled={requested}>
      {requested ? 'no location' : 'Share location'}
    </Button>
  );
}
