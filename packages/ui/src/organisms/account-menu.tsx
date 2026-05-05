'use client';

import { LogOut, Settings } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../atoms/avatar';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

export type AccountMenuState =
  | 'anonymous'
  | 'email_pending'
  | 'email_verified'
  | 'google_linked'
  | 'workspace_connected';

/**
 * Mirrors @lifecoach/user-state's UIAffordance union without creating a
 * package dep. If the canonical list changes there, widen this too.
 */
export type AccountMenuAffordance =
  | 'share_location_button'
  | 'save_progress_suggestion'
  | 'resend_verification_button'
  | 'sign_in_with_google_button'
  | 'connect_workspace_button'
  | 'workspace_connected_indicator';

export interface AccountMenuUser {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  uid: string;
  isAnonymous: boolean;
}

export interface AccountMenuProps {
  user: AccountMenuUser;
  state: AccountMenuState;
  affordances: readonly AccountMenuAffordance[];
  onOpenSettings: () => void;
  onSignOut: () => void;
  onGoogleSignIn?: () => void;
  onEmailSignIn?: () => void;
  onResendVerification?: () => void;
  onConnectWorkspace?: () => void;
  /** Fired whenever Radix flips the open state — used for telemetry. */
  onOpenChange?: (open: boolean) => void;
}

function stateLabel(state: AccountMenuState): string {
  switch (state) {
    case 'anonymous':
      return 'Guest';
    case 'email_pending':
      return 'Email pending';
    case 'email_verified':
      return 'Email verified';
    case 'google_linked':
      return 'Google';
    case 'workspace_connected':
      return 'Workspace';
  }
}

function stateBadgeTone(state: AccountMenuState): string {
  switch (state) {
    case 'anonymous':
      return 'bg-muted text-muted-foreground border border-border';
    case 'email_pending':
      return 'bg-accent/10 text-foreground border border-accent/40';
    case 'email_verified':
      return 'bg-accent/20 text-foreground border border-accent/40';
    case 'google_linked':
      return 'bg-accent/20 text-accent-foreground border border-accent/60';
    case 'workspace_connected':
      return 'bg-success/20 text-foreground border border-success/60';
  }
}

function initials(user: AccountMenuUser): string {
  const src = user.displayName || user.email || '';
  const base = src.trim();
  if (!base) return 'G';
  const parts = base.split(/[\s@]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase() || base[0]?.toUpperCase() || 'G';
}

function identityLine(user: AccountMenuUser): string {
  if (user.displayName) return user.displayName;
  if (user.email) return user.email;
  if (user.isAnonymous) return 'Guest';
  return `${user.uid.slice(0, 8)}…`;
}

function subtextLine(user: AccountMenuUser, state: AccountMenuState): string {
  if (user.isAnonymous) return 'Not saved — sign in to persist';
  if (user.email && user.displayName) return user.email;
  if (state === 'email_pending') return 'Verification pending';
  return user.uid.slice(0, 12);
}

export function AccountMenu({
  user,
  state,
  affordances,
  onOpenSettings,
  onSignOut,
  onGoogleSignIn,
  onEmailSignIn,
  onResendVerification,
  onConnectWorkspace,
  onOpenChange,
}: AccountMenuProps) {
  const renderedAffordances = affordances
    .map((aff) =>
      renderAffordance(aff, {
        onGoogleSignIn,
        onEmailSignIn,
        onResendVerification,
        onConnectWorkspace,
      }),
    )
    .filter(Boolean);

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="inline-flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-muted focus-visible:outline-none"
      >
        <Avatar>
          {user.photoURL ? <AvatarImage src={user.photoURL} alt="" /> : null}
          <AvatarFallback>{initials(user)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center gap-3 py-1">
          <Avatar className="h-10 w-10">
            {user.photoURL ? <AvatarImage src={user.photoURL} alt="" /> : null}
            <AvatarFallback>{initials(user)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="truncate text-sm font-semibold">{identityLine(user)}</span>
            <span className="truncate text-xs text-muted-foreground">
              {subtextLine(user, state)}
            </span>
          </div>
        </div>
        <div className="pb-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              stateBadgeTone(state),
            )}
          >
            {stateLabel(state)}
          </span>
        </div>
        {renderedAffordances.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            {renderedAffordances}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings className="h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderAffordance(
  aff: AccountMenuAffordance,
  cb: {
    onGoogleSignIn?: () => void;
    onEmailSignIn?: () => void;
    onResendVerification?: () => void;
    onConnectWorkspace?: () => void;
  },
): React.ReactElement | null {
  switch (aff) {
    case 'share_location_button':
      return null;
    case 'save_progress_suggestion':
      return (
        <AffordanceItem
          key={aff}
          label="Sign in with Google"
          subLabel="Save progress"
          onSelect={cb.onGoogleSignIn}
        />
      );
    case 'sign_in_with_google_button':
      return (
        <AffordanceItem key={aff} label="Link your Google account" onSelect={cb.onGoogleSignIn} />
      );
    case 'resend_verification_button':
      return (
        <AffordanceItem
          key={aff}
          label="Resend verification email"
          onSelect={cb.onResendVerification}
        />
      );
    case 'connect_workspace_button':
      return (
        <AffordanceItem
          key={aff}
          label="Connect Google Workspace"
          subLabel="Gmail, Calendar, Tasks"
          onSelect={cb.onConnectWorkspace}
        />
      );
    case 'workspace_connected_indicator':
      return null;
  }
}

function AffordanceItem({
  label,
  subLabel,
  disabled,
  onSelect,
}: {
  label: string;
  subLabel?: string;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={() => onSelect?.()}>
      <div className="flex flex-col">
        <span>{label}</span>
        {subLabel ? <span className="text-[10px] text-muted-foreground">{subLabel}</span> : null}
      </div>
    </DropdownMenuItem>
  );
}
