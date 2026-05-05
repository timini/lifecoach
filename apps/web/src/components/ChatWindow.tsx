'use client';

import {
  AccountMenu,
  type AccountMenuAffordance,
  Button,
  ChatComposer,
  ChatPageTemplate,
  ChatStream,
  type ChatStreamMessage,
  LocationBadge,
  type SessionItem,
  SessionsDrawer,
  SessionsDrawerTrigger,
  StarterPromptCard,
  Text,
} from '@lifecoach/ui';
import { UserStateMachine } from '@lifecoach/user-state';
import type { User } from 'firebase/auth';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completeEmailSignInLink,
  ensureSignedIn,
  linkWithGoogle,
  onAuthChange,
  sendEmailSignInLink,
  signOutCurrent,
} from '../lib/firebase';
import {
  type BrowserLocation,
  getLocationPermissionState,
  requestBrowserLocation,
} from '../lib/geolocation';
import { captureChatEvent } from '../lib/sentry';
import { sessionIdForToday } from '../lib/sessionId';
import { type Message, useChatStream } from '../lib/useChatStream';
import { connectWorkspace, fetchWorkspaceStatus } from '../lib/workspace';
import { DebugPanel, type SessionsOutcome } from './DebugPanel';

export function ChatWindow() {
  const t = useTranslations('chat');
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [location, setLocation] = useState<BrowserLocation | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [workspaceConnected, setWorkspaceConnected] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'live' | 'past'>('live');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [composerValue, setComposerValue] = useState('');
  const [lastSessionsOutcome, setLastSessionsOutcome] = useState<SessionsOutcome | null>(null);
  const [lastAccountMenuOpenChange, setLastAccountMenuOpenChange] = useState<{
    open: boolean;
    at: number;
  } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const todaySessionId = user ? sessionIdForToday(user.uid) : '';

  // `?debug=1` enables the dev overlay AND turns on the agent's debug
  // header so we get the full system prompt back per turn. Read once on
  // mount; same gate as DebugPanel so the two stay in sync.
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setDebug(params.get('debug') === '1');
  }, []);

  const {
    messages,
    busy,
    retryAttempt,
    sendText,
    setMessages,
    appendAssistantText,
    markAnswered,
    lastSystemPrompt,
  } = useChatStream({ user, sessionId, viewMode, location, debug });

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

  useEffect(() => {
    (async () => {
      try {
        if (typeof window !== 'undefined') {
          const upgraded = await completeEmailSignInLink(window.location.href);
          if (upgraded) {
            setUser(upgraded);
            return;
          }
        }
        const u = await ensureSignedIn();
        setUser(u);
      } catch (err: unknown) {
        setAuthError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  // Keep `user` in sync with auth-state changes from outside our handlers
  // (e2e window hook, refresh, etc.). Auto-recover from sign-out by minting
  // a fresh anonymous session — the user never sits on an empty screen.
  useEffect(() => {
    return onAuthChange((u) => {
      setUser(u);
      if (!u) {
        ensureSignedIn().catch((err: unknown) => {
          setAuthError(err instanceof Error ? err.message : String(err));
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setSessionId('');
      setViewMode('live');
      return;
    }
    setSessionId(sessionIdForToday(user.uid));
    setViewMode('live');
  }, [user]);

  const refreshSessions = useCallback(async () => {
    if (!user) {
      setSessions([]);
      const outcome: SessionsOutcome = { kind: 'skipped', reason: 'no_user', at: Date.now() };
      setLastSessionsOutcome(outcome);
      captureChatEvent('sessions.refresh_skipped', { reason: 'no_user' });
      return;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/sessions', {
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const outcome: SessionsOutcome = {
          kind: 'http_error',
          status: res.status,
          at: Date.now(),
        };
        setLastSessionsOutcome(outcome);
        captureChatEvent('sessions.refresh_http_error', {
          status: res.status,
          uid: user.uid,
        });
        return;
      }
      const body = (await res.json()) as { sessions?: SessionItem[] };
      const list = body.sessions ?? [];
      setSessions(list);
      const sampleIds = list.slice(0, 3).map((s) => s.sessionId);
      const outcome: SessionsOutcome = {
        kind: 'done',
        count: list.length,
        sampleIds,
        at: Date.now(),
      };
      setLastSessionsOutcome(outcome);
      captureChatEvent('sessions.refresh_done', {
        uid: user.uid,
        count: list.length,
        sampleIds,
      });
    } catch (err) {
      setSessions([]);
      const message = err instanceof Error ? err.message : String(err);
      const outcome: SessionsOutcome = { kind: 'threw', message, at: Date.now() };
      setLastSessionsOutcome(outcome);
      captureChatEvent('sessions.refresh_threw', { uid: user.uid, message });
    }
  }, [user]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setWorkspaceConnected(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchWorkspaceStatus(user);
        if (!cancelled) setWorkspaceConnected(status.connected);
      } catch {
        if (!cancelled) setWorkspaceConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rescroll on any render tick
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Generative-UI Picker → user-message bridge. Re-binds whenever sendText
  // identity changes so the closure captures the current dependencies.
  useEffect(() => {
    function onChoice(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.length > 0) {
        void sendText(detail);
      }
    }
    window.addEventListener('lifecoach:choice', onChoice);
    return () => window.removeEventListener('lifecoach:choice', onChoice);
  }, [sendText]);

  async function shareLocation() {
    setLocationRequested(true);
    const loc = await requestBrowserLocation();
    setLocation(loc);
  }

  function handleSelectSession(selectedId: string) {
    if (selectedId === sessionId) return;
    setSessionId(selectedId);
    setViewMode(selectedId === todaySessionId ? 'live' : 'past');
  }

  function handleBackToToday() {
    if (!user) return;
    setSessionId(sessionIdForToday(user.uid));
    setViewMode('live');
  }

  function submitChoice(mid: string, answer: string) {
    markAnswered(mid);
    void sendText(answer);
  }

  async function handleSignOut() {
    try {
      await signOutCurrent();
      setUser(null);
      setMessages([]);
      const fresh = await ensureSignedIn();
      setUser(fresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
    }
  }

  async function handleConnectWorkspace() {
    if (!user) return;
    try {
      const status = await connectWorkspace(user);
      setWorkspaceConnected(status.connected);
      void sendText('Connected — try that again please.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendAssistantText(`workspace connect failed: ${msg}`);
    }
  }

  function handleProInterest() {
    appendAssistantText("Thanks — we'll be in touch when Pro is ready.");
  }

  async function handleGoogleSignIn() {
    try {
      const upgraded = await linkWithGoogle();
      setUser(upgraded);
      void sendText("I've just signed in with Google.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendAssistantText(`sign-in error: ${msg}`);
    }
  }

  async function handleEmailSignIn(email: string) {
    try {
      const returnUrl = window.location.href;
      await sendEmailSignInLink(email, returnUrl);
      appendAssistantText(
        `Email sent to ${email} — check your inbox and click the link to finish.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendAssistantText(`email-link error: ${msg}`);
    }
  }

  if (authError) {
    return (
      <main className="mx-auto max-w-[720px] px-4 py-6 text-destructive">
        Sign-in failed: {authError}. Check NEXT_PUBLIC_FIREBASE_* env vars.
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-[720px] px-4 py-6 text-sm text-muted-foreground">
        Signing you in…
      </main>
    );
  }

  const stateMachine = UserStateMachine.fromFirebaseUser({
    isAnonymous: user.isAnonymous,
    emailVerified: user.emailVerified,
    providerData: user.providerData,
    workspaceScopesGranted: workspaceConnected,
  });
  const userState = stateMachine.current();
  const affordances = stateMachine
    .policy()
    .uiAffordances.map((a) => a.kind) as AccountMenuAffordance[];

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <SessionsDrawerTrigger
          onOpen={() => {
            setDrawerOpen(true);
            captureChatEvent('sessions.drawer_opened', {
              uid: user.uid,
              sessionsCountOnOpen: sessions.length,
              sampleIdsOnOpen: sessions.slice(0, 3).map((s) => s.sessionId),
              activeSessionId: sessionId,
              todaySessionId,
            });
            void refreshSessions();
          }}
        />
        <Text variant="serif-h1">Lifecoach</Text>
      </div>
      <div className="flex items-center gap-2">
        <LocationBadge
          shared={location !== null}
          requested={locationRequested}
          onShare={() => {
            void shareLocation();
          }}
        />
        <AccountMenu
          state={userState}
          affordances={affordances}
          user={{
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            uid: user.uid,
            isAnonymous: user.isAnonymous,
          }}
          onOpenSettings={() => {
            if (typeof window !== 'undefined') window.location.assign('/settings');
          }}
          onSignOut={() => void handleSignOut()}
          onGoogleSignIn={() => void handleGoogleSignIn()}
          onResendVerification={() => {
            if (user.email) void handleEmailSignIn(user.email);
          }}
          onConnectWorkspace={() => void handleConnectWorkspace()}
          onOpenChange={(open) => {
            setLastAccountMenuOpenChange({ open, at: Date.now() });
            captureChatEvent('account_menu.open_change', {
              open,
              uid: user.uid,
              state: userState,
              affordances,
            });
          }}
        />
      </div>
    </div>
  );

  const starterPrompts = t.raw('starters') as string[];

  const footer =
    viewMode === 'past' ? (
      <div className="flex justify-center">
        <Button
          type="button"
          onClick={handleBackToToday}
          variant="subtle"
          size="lg"
          data-testid="back-to-today"
        >
          Back to today
        </Button>
      </div>
    ) : (
      <ChatComposer
        value={composerValue}
        onChange={setComposerValue}
        onSubmit={(text) => void sendText(text)}
        disabled={busy}
        placeholder={t('placeholder')}
        sendLabel={t('placeholder')}
      />
    );

  const drawer = (
    <SessionsDrawer
      open={drawerOpen}
      onOpenChange={setDrawerOpen}
      sessions={sessions}
      activeSessionId={sessionId}
      todaySessionId={todaySessionId}
      onSelect={handleSelectSession}
    />
  );

  const showPending = busy && lastAssistantHasNoContent(messages);
  const pendingLabel = retryAttempt > 0 ? `${t('retry')}… (${retryAttempt})` : t('breathing');

  return (
    <ChatPageTemplate header={header} footer={footer} drawer={drawer}>
      {/* Stable test seam — Playwright waits on these to know the React
          state has caught up with whatever auth flip just happened. */}
      <div
        data-testid="chat-window-state"
        data-uid={user.uid}
        data-session-id={sessionId}
        data-busy={busy ? 'true' : 'false'}
        hidden
      />
      {messages.length === 0 && (
        <div className="space-y-3">
          <Text variant="caption" tone="muted">
            Take a breath — we can start wherever you are.
          </Text>
          <div className="flex flex-wrap gap-2">
            {starterPrompts.map((prompt) => (
              <StarterPromptCard key={prompt} prompt={prompt} onSelect={(p) => void sendText(p)} />
            ))}
          </div>
        </div>
      )}
      <ChatStream
        messages={toChatStreamMessages(messages)}
        pending={showPending}
        pendingLabel={pendingLabel}
        onChoice={submitChoice}
        onGoogleSignIn={() => void handleGoogleSignIn()}
        onEmailSignIn={handleEmailSignIn}
        onConnectWorkspace={() => void handleConnectWorkspace()}
        onProInterest={handleProInterest}
      />
      <div ref={endRef} />
      <DebugPanel
        user={user}
        sessionId={sessionId}
        todaySessionId={todaySessionId}
        workspaceConnected={workspaceConnected}
        drawerOpen={drawerOpen}
        sessionsCount={sessions.length}
        sessionsSampleIds={sessions.slice(0, 3).map((s) => s.sessionId)}
        lastSessionsOutcome={lastSessionsOutcome}
        lastAccountMenuOpenChange={lastAccountMenuOpenChange}
        messageCount={messages.length}
        busy={busy}
        lastSystemPrompt={lastSystemPrompt}
      />
    </ChatPageTemplate>
  );
}

/**
 * True when the most recent assistant message has zero rendered elements —
 * i.e., we've seeded an empty bubble but nothing has streamed yet. Gates the
 * "thinking…" placeholder so it only shows during the initial silent window.
 */
function lastAssistantHasNoContent(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === 'assistant') return m.elements.length === 0;
    if (m.role === 'user') return true;
  }
  return true;
}

/**
 * The hook's Message type structurally matches ChatStreamMessage; this is a
 * widening cast that keeps the boundary explicit so a future change to either
 * shape becomes a compile error here rather than a runtime drift.
 */
function toChatStreamMessages(messages: Message[]): ChatStreamMessage[] {
  return messages.map((m) =>
    m.role === 'user'
      ? ({
          id: m.id,
          role: 'user',
          text: m.text,
          timestamp: m.timestamp,
        } satisfies ChatStreamMessage)
      : ({
          id: m.id,
          role: 'assistant',
          elements: m.elements,
          answered: m.answered,
          timestamp: m.timestamp,
        } satisfies ChatStreamMessage),
  );
}
