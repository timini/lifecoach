'use client';

import { cn } from '../lib/utils';

export interface SettingsTab<TId extends string = string> {
  id: TId;
  label: string;
}

export interface SettingsTabsProps<TId extends string = string> {
  tabs: ReadonlyArray<SettingsTab<TId>>;
  activeId: TId;
  onChange: (id: TId) => void;
  /** ARIA group label — visually hidden, purely for screen readers. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Sticky tab strip used by /settings. Each tab is a real <button role="tab">
 * so keyboard navigation rides for free; aria-selected drives styling.
 */
export function SettingsTabs<TId extends string = string>({
  tabs,
  activeId,
  onChange,
  ariaLabel = 'Settings sections',
  className,
}: SettingsTabsProps<TId>) {
  return (
    <nav
      aria-label={ariaLabel}
      role="tablist"
      className={cn(
        'sticky top-0 z-10 flex gap-1 border-b border-border bg-background pt-1 pb-0',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
