'use client';

import type { WorkspaceStatus } from '@lifecoach/shared-types';
import {
  Button,
  ConnectionRow,
  GoalLog,
  type GoalLogEntry,
  type JsonObject,
  type JsonValue,
  SettingsPageTemplate,
  type SettingsTab,
  SettingsTabs,
  Text,
  YamlTree,
  lastModifiedByPath,
} from '@lifecoach/ui';
import { UserStateMachine } from '@lifecoach/user-state';
import type { User } from 'firebase/auth';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { LanguagePicker } from '../../components/LanguagePicker';
import { isLocale } from '../../i18n/routing';
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

/**
 * Audit log entry shape returned by `GET /api/profile`. Surfaced as
 * `{path → modifiedAt}` per leaf when the YamlTree renders.
 */
interface ProfileHistoryEntry {
  path: string;
  before?: unknown;
  after?: unknown;
  at: string;
}

type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: JsonObject; history: ProfileHistoryEntry[] }
  | { status: 'error'; message: string };

type GoalsState =
  | { status: 'loading' }
  | { status: 'ready'; entries: GoalLogEntry[] }
  | { status: 'error'; message: string };

type TabId = 'connections' | 'practices' | 'profile' | 'goals' | 'account';

export default function SettingsPage() {
  const router = useRouter();
  const t = useTranslations('settings');
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : 'en';
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>({ status: 'loading' });
  const [goalsState, setGoalsState] = useState<GoalsState>({ status: 'loading' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [location, setLocation] = useState<BrowserLocation | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('connections');
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
      const body = (await res.json()) as {
        profile?: JsonObject;
        history?: ProfileHistoryEntry[];
      };
      setProfileState({
        status: 'ready',
        profile: body.profile ?? {},
        history: Array.isArray(body.history) ? body.history : [],
      });
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
    const prevProfile = profileState.status === 'ready' ? profileState.profile : {};
    const prevHistory = profileState.status === 'ready' ? profileState.history : [];
    setProfileState({ status: 'ready', profile, history: prevHistory });
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
      setProfileState({ status: 'ready', profile: prevProfile, history: prevHistory });
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

  const tabs: ReadonlyArray<SettingsTab<TabId>> = [
    { id: 'connections', label: t('tabs.connections') },
    { id: 'practices', label: t('tabs.practices') },
    { id: 'profile', label: t('tabs.profile') },
    { id: 'goals', label: t('tabs.goals') },
    { id: 'account', label: t('tabs.account') },
  ];

  const header = (
    <>
      <div className="flex items-center justify-between">
        <Text variant="serif-h3" as="h1">
          {t('title')}
        </Text>
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← {t('back')}
        </Link>
      </div>
      <Text variant="caption">{t('subtitle')}</Text>
    </>
  );

  const footer = (
    <Text variant="caption">
      Current state: <span className="font-mono">{state}</span>
      {savingProfile ? ' · saving…' : ''}
    </Text>
  );

  const googleLinked = user.providerData.some((p) => p.providerId === 'google.com');
  const emailVerified = user.emailVerified;
  const hasEmail = Boolean(user.email);

  return (
    <SettingsPageTemplate
      header={header}
      footer={footer}
      tabs={<SettingsTabs<TabId> tabs={tabs} activeId={activeTab} onChange={setActiveTab} />}
    >
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
          <Text variant="caption">Loading…</Text>
        ) : profileState.status === 'error' ? (
          <Text variant="caption" tone="destructive">
            {profileState.message}
          </Text>
        ) : (
          <PracticesSection
            profile={profileState.profile}
            onChange={(next) => void handleProfileChange(next)}
          />
        )
      ) : null}

      {activeTab === 'profile' ? (
        <section className="flex flex-col gap-4">
          <LanguagePicker user={user} locale={locale} />
          <hr className="border-border" />
          <Text variant="caption">
            What the coach remembers about you. Click any value to edit. Add any key — the coach
            will also write here as it gets to know you.
          </Text>
          {profileState.status === 'loading' ? (
            <Text variant="caption">Loading…</Text>
          ) : profileState.status === 'error' ? (
            <Text variant="caption" tone="destructive">
              {profileState.message}
            </Text>
          ) : (
            <YamlTree
              value={profileState.profile}
              onChange={(v) => void handleProfileChange(v)}
              modifiedAtByPath={lastModifiedByPath(profileState.history)}
            />
          )}
        </section>
      ) : null}

      {activeTab === 'goals' ? (
        <section className="flex flex-col gap-3">
          {goalsState.status === 'loading' ? (
            <Text variant="caption">Loading…</Text>
          ) : goalsState.status === 'error' ? (
            <Text variant="caption" tone="destructive">
              {goalsState.message}
            </Text>
          ) : (
            <GoalLog entries={goalsState.entries} />
          )}
        </section>
      ) : null}

      {activeTab === 'account' ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-container)] border border-destructive/40 bg-destructive/10 p-3">
            <Text variant="caption" className="flex-1">
              Sign out returns to a fresh guest chat. Your data stays on the server.
            </Text>
            <Button variant="subtle" size="md" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-container)] border border-border bg-muted/40 p-3">
            <Text variant="caption" className="flex-1">
              Delete all my data
              <span className="ml-2 inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Coming soon
              </span>
            </Text>
            <Button variant="subtle" size="md" disabled>
              Delete
            </Button>
          </div>
        </section>
      ) : null}
    </SettingsPageTemplate>
  );
}

function IconDot() {
  return <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" aria-hidden="true" />;
}
