'use client';

import type { WorkspaceStatus } from '@lifecoach/shared-types';
import {
  Button,
  ChatShell,
  ConnectionRow,
  GoalLog,
  type GoalLogEntry,
  type JsonObject,
  type JsonValue,
  YamlTree,
  cn,
} from '@lifecoach/ui';
import { UserStateMachine } from '@lifecoach/user-state';
import type { User } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ensureSignedIn,
  linkWithGoogle,
  sendEmailSignInLink,
  signOutCurrent,
} from '../../lib/firebase';
import {
  type BrowserLocation,
  getLocationPermissionState,
  requestBrowserLocation,
} from '../../lib/geolocation';
import { connectWorkspace, fetchWorkspaceStatus, revokeWorkspace } from '../../lib/workspace';
import { PracticesSection } from './PracticesSection';

type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: JsonObject }
  | { status: 'error'; message: string };

type GoalsState =
  | { status: 'loading' }
  | { status: 'ready'; entries: GoalLogEntry[] }
  | { status: 'error'; message: string };

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>({ status: 'loading' });
  const [goalsState, setGoalsState] = useState<GoalsState>({ status: 'loading' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [location, setLocation] = useState<BrowserLocation | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [activeTab, setActiveTab] = useState<
    'connections' | 'practices' | 'profile' | 'goals' | 'account'
  >('connections');
  const [workspace, setWorkspace] = useState<WorkspaceStatus>({
    connected: false,
    scopes: [],
    grantedAt: null,
  });
  const [workspaceBusy, setWorkspaceBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const u = await ensureSignedIn();
        setUser(u);
      } catch (err: unknown) {
        setAuthError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  useEffect(() => {
    // Resume location silently when already granted — no re-prompt on refresh.
    (async () => {
      const state = await getLocationPermissionState();
      if (state !== 'granted') return;
      const loc = await requestBrowserLocation();
      if (loc) {
        setLocation(loc);
        setLocationRequested(true);
      }
    })();
  }, []);

  const loadProfile = useCallback(async (u: User) => {
    setProfileState({ status: 'loading' });
    try {
      const idToken = await u.getIdToken();
      const res = await fetch(`/api/profile?userId=${encodeURIComponent(u.uid)}`, {
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`profile fetch: ${res.status}`);
      const body = (await res.json()) as { profile?: JsonObject };
      setProfileState({ status: 'ready', profile: body.profile ?? {} });
    } catch (err) {
      setProfileState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const loadGoals = useCallback(async (u: User) => {
    setGoalsState({ status: 'loading' });
    try {
      const idToken = await u.getIdToken();
      const res = await fetch(`/api/goals?userId=${encodeURIComponent(u.uid)}`, {
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`goals fetch: ${res.status}`);
      const body = (await res.json()) as { updates?: GoalLogEntry[] };
      setGoalsState({ status: 'ready', entries: body.updates ?? [] });
    } catch (err) {
      setGoalsState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadProfile(user);
    void loadGoals(user);
    void (async () => {
      try {
        const status = await fetchWorkspaceStatus(user);
        setWorkspace(status);
      } catch {
        // Missing or 4xx — treat as disconnected; row will say Not connected.
      }
    })();
  }, [user, loadProfile, loadGoals]);

  async function handleConnectWorkspace() {
    if (!user) return;
    setWorkspaceBusy(true);
    try {
      const status = await connectWorkspace(user);
      setWorkspace(status);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleRevokeWorkspace() {
    if (!user) return;
    setWorkspaceBusy(true);
    try {
      const status = await revokeWorkspace(user);
      setWorkspace(status);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleProfileChange(next: JsonValue) {
    if (!user) return;
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return;
    const profile = next as JsonObject;
    // Optimistic update so the tree feels responsive; revert on error.
    const prev = profileState.status === 'ready' ? profileState.profile : {};
    setProfileState({ status: 'ready', profile });
    setSavingProfile(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok) throw new Error(`PATCH /api/profile: ${res.status}`);
    } catch (err) {
      setProfileState({ status: 'ready', profile: prev });
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleShareLocation() {
    setLocationRequested(true);
    const loc = await requestBrowserLocation();
    setLocation(loc);
  }

  async function handleLinkGoogle() {
    try {
      const upgraded = await linkWithGoogle();
      setUser(upgraded);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSendEmail() {
    if (!emailDraft.includes('@')) return;
    try {
      await sendEmailSignInLink(emailDraft, window.location.href);
      setEmailDraft('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSignOut() {
    await signOutCurrent();
    router.push('/');
  }

  if (authError) {
    return <main className="mx-auto max-w-[720px] px-4 py-6 text-destructive">{authError}</main>;
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-[720px] px-4 py-6 text-sm text-muted-foreground">
        Signing you in…
      </main>
    );
  }

  const state = UserStateMachine.fromFirebaseUser({
    isAnonymous: user.isAnonymous,
    emailVerified: user.emailVerified,
    providerData: user.providerData,
  }).current();

  const header = (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Your settings</h1>
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← Back to chat
        </Link>
      </div>
      <p className="text-xs text-foreground/75">
        Connections, profile the coach has built, and your goal log.
      </p>
    </>
  );

  const footer = (
    <p className="text-xs text-foreground/75">
      Current state: <span className="font-mono">{state}</span>
      {savingProfile ? ' · saving…' : ''}
    </p>
  );

  const googleLinked = user.providerData.some((p) => p.providerId === 'google.com');
  const emailVerified = user.emailVerified;
  const hasEmail = Boolean(user.email);

  const tabs: Array<{ id: typeof activeTab; label: string }> = [
    { id: 'connections', label: 'Connections' },
    { id: 'practices', label: 'Practices' },
    { id: 'profile', label: 'Profile' },
    { id: 'goals', label: 'Goal log' },
    { id: 'account', label: 'Account' },
  ];

  return (
    <ChatShell header={header} footer={footer}>
      <nav
        aria-label="Settings sections"
        className="sticky top-0 z-10 flex gap-1 border-b border-border bg-background pt-1 pb-0"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              activeTab === t.id
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'connections' ? (
        <section className="flex flex-col gap-3">
          <ConnectionRow
            icon={<IconDot />}
            label="Google account"
            status={googleLinked ? `Linked as ${user.email ?? 'Google user'}` : 'Not linked'}
            statusTone={googleLinked ? 'success' : 'muted'}
            action={
              googleLinked ? null : (
                <Button size="sm" onClick={() => void handleLinkGoogle()}>
                  Sign in
                </Button>
              )
            }
          />
          <ConnectionRow
            icon={<IconDot />}
            label="Email"
            status={
              hasEmail
                ? emailVerified
                  ? `Verified: ${user.email}`
                  : `Pending verification: ${user.email}`
                : 'None'
            }
            statusTone={hasEmail && emailVerified ? 'success' : hasEmail ? 'accent' : 'muted'}
            action={
              hasEmail ? null : (
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleSendEmail()}
                    disabled={!emailDraft.includes('@')}
                  >
                    Send link
                  </Button>
                </div>
              )
            }
          />
          <ConnectionRow
            icon={<IconDot />}
            label="Google Workspace"
            status={
              workspace.connected
                ? `Connected — Gmail, Calendar, Tasks${
                    workspace.grantedAt
                      ? ` · since ${new Date(workspace.grantedAt).toLocaleDateString()}`
                      : ''
                  }`
                : 'Not connected — read & send email, manage calendar and tasks'
            }
            statusTone={workspace.connected ? 'success' : 'muted'}
            action={
              workspace.connected ? (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => void handleRevokeWorkspace()}
                  disabled={workspaceBusy}
                >
                  Revoke
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void handleConnectWorkspace()}
                  disabled={workspaceBusy || !googleLinked}
                  title={googleLinked ? undefined : 'Sign in with Google first'}
                >
                  Connect
                </Button>
              )
            }
          />
          <ConnectionRow
            icon={<IconDot />}
            label="Device location"
            status={
              location
                ? `Shared (±${Math.round(location.accuracy)}m) · ${location.lat.toFixed(3)},${location.lng.toFixed(3)}`
                : locationRequested
                  ? 'Denied or unavailable'
                  : 'Not shared'
            }
            statusTone={location ? 'success' : locationRequested ? 'warn' : 'muted'}
            action={
              location ? null : (
                <Button
                  size="sm"
                  onClick={() => void handleShareLocation()}
                  disabled={locationRequested}
                >
                  Enable
                </Button>
              )
            }
          />
        </section>
      ) : null}

      {activeTab === 'practices' ? (
        profileState.status === 'loading' ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : profileState.status === 'error' ? (
          <div className="text-xs text-destructive">{profileState.message}</div>
        ) : (
          <PracticesSection
            profile={profileState.profile}
            onChange={(next) => void handleProfileChange(next)}
          />
        )
      ) : null}

      {activeTab === 'profile' ? (
        <section className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            What the coach remembers about you. Click any value to edit. Add any key — the coach
            will also write here as it gets to know you.
          </p>
          {profileState.status === 'loading' ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : profileState.status === 'error' ? (
            <div className="text-xs text-destructive">{profileState.message}</div>
          ) : (
            <YamlTree value={profileState.profile} onChange={(v) => void handleProfileChange(v)} />
          )}
        </section>
      ) : null}

      {activeTab === 'goals' ? (
        <section className="flex flex-col gap-3">
          {goalsState.status === 'loading' ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : goalsState.status === 'error' ? (
            <div className="text-xs text-destructive">{goalsState.message}</div>
          ) : (
            <GoalLog entries={goalsState.entries} />
          )}
        </section>
      ) : null}

      {activeTab === 'account' ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-container)] border border-destructive/40 bg-destructive/10 p-3">
            <div className="flex-1 text-xs text-muted-foreground">
              Sign out returns to a fresh guest chat. Your data stays on the server.
            </div>
            <Button variant="subtle" size="md" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-container)] border border-border bg-muted/40 p-3">
            <div className="flex-1 text-xs text-muted-foreground">
              Delete all my data
              <span className="ml-2 inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Coming soon
              </span>
            </div>
            <Button variant="subtle" size="md" disabled>
              Delete
            </Button>
          </div>
        </section>
      ) : null}
    </ChatShell>
  );
}

function IconDot() {
  return <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" aria-hidden="true" />;
}
