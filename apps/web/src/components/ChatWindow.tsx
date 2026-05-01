'use client';

import {
  AccountMenu,
  type AccountMenuAffordance,
  AuthPrompt,
  Bubble,
  Button,
  ChatShell,
  ChoicePrompt,
  Input,
  LocationBadge,
  Markdown,
  type SessionItem,
  SessionsDrawer,
  SessionsDrawerTrigger,
  ToolCallBadge,
  UpgradePrompt,
  WorkspacePrompt,
} from '@lifecoach/ui';
import { Renderer, library as openUILibrary } from '@lifecoach/ui/openui';
import { UserStateMachine } from '@lifecoach/user-state';
import type { User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { eventsToMessages } from '../lib/eventHistory';
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
import { sessionIdForToday } from '../lib/sessionId';
import { type AssistantElement, type AssistantOp, parseSseBlock } from '../lib/sse';
import { connectWorkspace, fetchWorkspaceStatus } from '../lib/workspace';

interface UserMessage {
  id: string;
  role: 'user';
  text: string;
}
interface AssistantMessage {
  id: string;
  role: 'assistant';
  elements: AssistantElement[];
  answered?: boolean;
}
type Message = UserMessage | AssistantMessage;

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // 0 = first attempt in flight (or idle). 1+ = currently retrying after
  // a network blip. Drives the "retrying…" indicator copy.
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [location, setLocation] = useState<BrowserLocation | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  // Tracks sessionIds we've already kicked off in this tab — guards against
  // double-firing on StrictMode re-runs of the history-load effect.
  const kickedOffRef = useRef<Set<string>>(new Set());

  // SessionId is bound to the firebase uid: returning users (same uid → same
  // sessionId) reload their previous chat; fresh anon users get a fresh one.
  // Empty string until auth settles — guards in fetchAndApplyHistory/sendText
  // already short-circuit on `!user`, so no /history call fires before this.
  const [sessionId, setSessionId] = useState<string>('');

  // Workspace connection state lives in Firestore (server-side), not in the
  // Firebase user object — so we have to fetch it post-sign-in. Drives the
  // workspace_connected state in UserStateMachine, which decides whether
  // the AccountMenu shows the "Connect Workspace" affordance.
  const [workspaceConnected, setWorkspaceConnected] = useState(false);

  // Sidebar drawer state. `viewMode` distinguishes today's live chat from
  // browsing a past session (read-only — no input, no kickoff). `sessions`
  // is the list rendered inside the drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'live' | 'past'>('live');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const todaySessionId = user ? sessionIdForToday(user.uid) : '';

  useEffect(() => {
    // Resume location silently if the browser already granted permission in
    // a prior visit. Avoids re-prompting on every page refresh.
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
    // If the current URL is a Firebase email-link return, finish the link
    // first so the user we set is the upgraded one. Otherwise this is a
    // no-op and we fall through to the usual anonymous sign-in.
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

  // Permanent auth-state subscription — keeps `user` in sync when auth
  // changes outside our handlers (e.g. the e2e window hook calls
  // signInWithEmailAndPassword, or a future SDK upgrade emits a refresh).
  // Cheap because Firebase de-dupes identical user emissions.
  //
  // When auth lands on `null` (sign-out via the window hook, externally
  // revoked session, …) we kick off an anonymous re-sign-in so the user
  // never sits on an empty "Signing you in…" screen — same behaviour as
  // handleSignOut, but reachable from any sign-out path.
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

  // Resolve today's sessionId for the currently-signed-in uid. Runs after
  // every user change. The id is fully derived from (uid, todayDateLocal)
  // — calling at midnight will roll to a fresh session.
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
      return;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/sessions', {
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { sessions?: SessionItem[] };
      setSessions(body.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, [user]);

  // Initial fetch + whenever the user changes. The drawer-open handler
  // also calls refreshSessions to catch the brand-new session doc written
  // by the kickoff turn — that change isn't visible to a deps-array
  // subscriber on (user, sessionId) since sessionId stays stable.
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Fetch workspace connection status whenever the user changes. Anonymous
  // users can't have workspace tokens, so skip the round-trip. Failures are
  // swallowed — if we can't tell, default to "not connected" which renders
  // the (harmless) Connect button rather than a broken Connected indicator.
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

  /**
   * Fetches the canonical Firestore-backed transcript for this session.
   * Used both on initial mount and as the recovery path when the SSE
   * stream from /api/chat is interrupted mid-flight — the agent usually
   * completes and persists even when the browser drops the connection,
   * so re-pulling history is a safe, idempotent way to surface the real
   * outcome without double-sending the user's message.
   */
  const fetchAndApplyHistory = useCallback(async (): Promise<Message[] | null> => {
    if (!user || !sessionId) return null;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/chat/history?userId=${encodeURIComponent(user.uid)}&sessionId=${encodeURIComponent(sessionId)}`,
        { headers: { authorization: `Bearer ${idToken}` } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { events?: unknown[] };
      const rehydrated: Message[] = eventsToMessages((body.events ?? []) as never).map((m) =>
        m.role === 'user'
          ? { id: m.id, role: 'user', text: m.text }
          : { id: m.id, role: 'assistant', elements: m.elements, answered: true },
      );
      return rehydrated;
    } catch {
      return null;
    }
  }, [user, sessionId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // Clear any stale transcript from a previous uid before the new
    // history loads — otherwise sign-out → fresh anon would still show
    // the old user's bubbles until the empty /history response lands
    // (which it never does for a brand-new anon with no Firestore doc).
    setMessages([]);
    (async () => {
      const rehydrated = await fetchAndApplyHistory();
      if (cancelled) return;
      if (rehydrated && rehydrated.length > 0) {
        setMessages(rehydrated);
        return;
      }
      // Empty live session → fire the first-of-day kickoff so the agent
      // produces its greeting bubble without the user having to type
      // anything. The sentinel is filtered out of any future rehydration.
      if (
        viewMode === 'live' &&
        sessionId &&
        !kickedOffRef.current.has(sessionId) &&
        rehydrated !== null
      ) {
        kickedOffRef.current.add(sessionId);
        void sendText('__session_start__', { hidden: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, fetchAndApplyHistory, sessionId, viewMode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rescroll on any render tick
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Generative-UI Picker → user-message bridge. The Picker in the OpenUI
  // library dispatches a `lifecoach:choice` CustomEvent with the answer;
  // here we treat it exactly like a typed message. Re-binds whenever
  // user/sessionId/location/busy change so sendText's closure is fresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — listener forwards detail to sendText which depends on these
  useEffect(() => {
    function onChoice(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.length > 0) {
        void sendText(detail);
      }
    }
    window.addEventListener('lifecoach:choice', onChoice);
    return () => window.removeEventListener('lifecoach:choice', onChoice);
  }, [user, sessionId, location, busy]);

  async function shareLocation() {
    setLocationRequested(true);
    const loc = await requestBrowserLocation();
    setLocation(loc);
  }

  function handleSelectSession(selectedId: string) {
    if (selectedId === sessionId) return;
    setMessages([]);
    setSessionId(selectedId);
    setViewMode(selectedId === todaySessionId ? 'live' : 'past');
  }

  function handleBackToToday() {
    if (!user) return;
    const todayId = sessionIdForToday(user.uid);
    setMessages([]);
    setSessionId(todayId);
    setViewMode('live');
  }

  async function sendText(text: string, opts?: { hidden?: boolean }) {
    if (!text.trim() || busy || !user || !sessionId || viewMode === 'past') return;
    const hidden = opts?.hidden === true;
    if (!hidden) setInput('');
    setBusy(true);
    if (!hidden) {
      setMessages((prev) => [...prev, { id: messageId(), role: 'user', text }]);
    }

    const assistantId = messageId();
    // Seed an empty assistant message immediately so streaming ops can
    // update it in place instead of racing to create it.
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', elements: [] }]);

    // One round-trip: POST → consume SSE → apply ops. Throws on network
    // errors before headers, on fetch rejection, and on stream read
    // errors. The retry loop below decides whether to retry or give up.
    const attemptOnce = async (): Promise<void> => {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          userId: user.uid,
          sessionId,
          message: text,
          ...(location ? { location } : {}),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!res.body) {
        // Fallback: no streaming body (should never happen on modern
        // browsers) — degrade to the old blob-parse path.
        const raw = await res.text();
        for (const block of raw.split(/\n\n+/)) {
          applyOps(assistantId, parseSseBlock(block));
        }
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          applyOps(assistantId, parseSseBlock(block));
        }
      }
      if (buffer.trim()) applyOps(assistantId, parseSseBlock(buffer));
    };

    // Retry loop. A "Failed to fetch" is almost always a transient
    // pre-connection blip (DNS, TLS, brief network drop). Surfacing
    // that raw error to the user is hostile — silently retry first.
    // Between attempts: clear the assistant bubble so a partial
    // first-attempt response doesn't bleed into the retry, and check
    // history in case the agent did finish persisting a reply despite
    // the dropped stream.
    const MAX_RETRIES = 2;
    let succeeded = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        setRetryAttempt(attempt);
        // Exponential-ish backoff: 600ms, 1200ms, ...
        await new Promise((r) => setTimeout(r, 600 * attempt));
        // Reset the assistant bubble for a clean retry.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.role === 'assistant' ? { ...m, elements: [] } : m,
          ),
        );
      }
      try {
        await attemptOnce();
        succeeded = true;
        break;
      } catch {
        // Did the agent already finish on a previous attempt? If
        // history has a user message matching ours followed by an
        // assistant turn, that transcript wins — no further retries.
        const rehydrated = await fetchAndApplyHistory().catch(() => null);
        const replied = rehydrated?.some(
          (m, i) =>
            m.role === 'user' &&
            m.text === text &&
            rehydrated.slice(i + 1).some((later) => later.role === 'assistant'),
        );
        if (rehydrated && replied) {
          setMessages(rehydrated);
          succeeded = true;
          break;
        }
        // Otherwise: keep trying.
      }
    }
    setRetryAttempt(0);

    if (succeeded) {
      // Stream completed without throwing. If the assistant message
      // still has no visible content, the model returned an empty turn
      // (or stream lost the reply on the wire). Try Firestore history
      // once; only fall back to a friendly placeholder if that's also
      // empty for this turn.
      const isVisible = (els: AssistantElement[]) =>
        els.some((el) => el.kind !== 'tool-call' || (el.kind === 'tool-call' && el.done && el.ok));
      let currentEmpty = false;
      setMessages((prev) => {
        const m = prev.find((x) => x.id === assistantId);
        if (m && m.role === 'assistant' && !isVisible(m.elements)) currentEmpty = true;
        return prev;
      });
      if (currentEmpty) {
        const rehydrated = await fetchAndApplyHistory().catch(() => null);
        const ourMessageLanded = rehydrated?.some(
          (m, i) =>
            m.role === 'user' &&
            m.text === text &&
            rehydrated.slice(i + 1).some((later) => later.role === 'assistant'),
        );
        if (rehydrated && ourMessageLanded) {
          setMessages(rehydrated);
        } else {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId || m.role !== 'assistant') return m;
              if (isVisible(m.elements)) return m;
              return {
                ...m,
                elements: [
                  {
                    kind: 'text',
                    text: 'Hmm, I missed that — could you say it again?',
                  },
                ],
              };
            }),
          );
        }
      }
    } else {
      // Exhausted retries. Show a friendly, action-oriented message
      // — never the raw "Failed to fetch" exception.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.role === 'assistant'
            ? {
                ...m,
                elements: [
                  ...m.elements,
                  {
                    kind: 'text',
                    text: "Couldn't reach me just now — give it another go in a moment?",
                  },
                ],
              }
            : m,
        ),
      );
    }

    setBusy(false);
  }

  /**
   * Applies a batch of streaming SSE operations to the assistant message
   * with the given id. Safe to call inside React state setters because
   * `setMessages` takes a pure-function updater.
   */
  function applyOps(msgId: string, ops: AssistantOp[]) {
    if (ops.length === 0) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || m.role !== 'assistant') return m;
        let elements: AssistantElement[] = m.elements;
        for (const op of ops) {
          if (op.op === 'append-text') {
            const last = elements[elements.length - 1];
            if (last?.kind === 'text') {
              elements = [...elements.slice(0, -1), { kind: 'text', text: last.text + op.text }];
            } else {
              elements = [...elements, { kind: 'text', text: op.text }];
            }
          } else if (op.op === 'push') {
            elements = [...elements, op.element];
          } else if (op.op === 'finish-tool-call') {
            elements = elements.map((el) =>
              el.kind === 'tool-call' && el.id === op.id && !el.done
                ? { ...el, done: true, ok: op.ok }
                : el,
            );
          }
        }
        return { ...m, elements };
      }),
    );
  }

  function submitChoice(mid: string, answer: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === mid && m.role === 'assistant' ? { ...m, answered: true } : m)),
    );
    void sendText(answer);
  }

  async function handleSignOut() {
    try {
      await signOutCurrent();
      setUser(null);
      setMessages([]);
      // SessionId follows the uid — the [user] effect will derive a fresh
      // sessionId for the new anonymous user once setUser fires below.
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
      // Flip local state so the AccountMenu hides the Connect button on
      // the very next render, without waiting for a status round-trip.
      setWorkspaceConnected(status.connected);
      // Nudge the agent's next turn so the LLM sees the state flip and
      // can fulfil the original request.
      void sendText('Connected — try that again please.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId(),
          role: 'assistant',
          elements: [{ kind: 'text', text: `workspace connect failed: ${msg}` }],
        },
      ]);
    }
  }

  function handleProInterest() {
    setMessages((prev) => [
      ...prev,
      {
        id: messageId(),
        role: 'assistant',
        elements: [{ kind: 'text', text: "Thanks — we'll be in touch when Pro is ready." }],
      },
    ]);
  }

  async function handleGoogleSignIn() {
    try {
      const upgraded = await linkWithGoogle();
      setUser(upgraded);
      // Let the agent know it worked; its next turn's ID token will show
      // google.com as the sign_in_provider and flip UserStateMachine.
      void sendText("I've just signed in with Google.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId(),
          role: 'assistant',
          elements: [{ kind: 'text', text: `sign-in error: ${msg}` }],
        },
      ]);
    }
  }

  async function handleEmailSignIn(email: string) {
    try {
      const returnUrl = window.location.href;
      await sendEmailSignInLink(email, returnUrl);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId(),
          role: 'assistant',
          elements: [
            {
              kind: 'text',
              text: `Email sent to ${email} — check your inbox and click the link to finish.`,
            },
          ],
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId(),
          role: 'assistant',
          elements: [{ kind: 'text', text: `email-link error: ${msg}` }],
        },
      ]);
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
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SessionsDrawerTrigger
            onOpen={() => {
              setDrawerOpen(true);
              void refreshSessions();
            }}
          />
          <h1 className="text-2xl font-semibold tracking-tight">Lifecoach</h1>
        </div>
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
        />
      </div>
      <div className="hidden items-center justify-end">
        <LocationBadge
          shared={location !== null}
          requested={locationRequested}
          onShare={() => {
            void shareLocation();
          }}
        />
      </div>
    </>
  );

  const starterPrompts = [
    'I need help grounding myself today.',
    "Let's map out a fresh vision for my week.",
    'Give me a space to untangle my thoughts.',
  ];

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
      <form
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[760px] gap-2 border-t border-border/70 bg-background/85 px-4 py-3 shadow-[0_-8px_24px_rgba(43,58,50,0.10)] backdrop-blur-md"
        onSubmit={(e) => {
          e.preventDefault();
          void sendText(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={busy}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={busy || !input.trim()}
          size="lg"
          className={input.trim() ? 'bg-accent text-accent-foreground hover:opacity-100' : ''}
        >
          Send
        </Button>
        <LocationBadge
          shared={location !== null}
          requested={locationRequested}
          onShare={() => {
            void shareLocation();
          }}
        />
      </form>
    );

  return (
    <ChatShell header={header} footer={footer}>
      <SessionsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        sessions={sessions}
        activeSessionId={sessionId}
        todaySessionId={todaySessionId}
        onSelect={handleSelectSession}
      />
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
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Take a breath — we can start wherever you are.</p>
          <div className="flex flex-wrap gap-2">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-full border border-border/70 bg-white/60 px-4 py-2 text-sm text-foreground transition hover:border-accent/70 hover:bg-white/85"
                onClick={() => void sendText(prompt)}
                disabled={busy}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <Bubble key={m.id} from="user">
              {m.text}
            </Bubble>
          );
        }
        return (
          <AssistantGroup
            key={m.id}
            msgId={m.id}
            elements={m.elements}
            answered={Boolean(m.answered)}
            onChoice={submitChoice}
            onGoogleSignIn={() => void handleGoogleSignIn()}
            onEmailSignIn={handleEmailSignIn}
            onConnectWorkspace={() => void handleConnectWorkspace()}
            onProInterest={handleProInterest}
          />
        );
      })}
      {busy && lastAssistantHasNoContent(messages) && (
        <div className="flex items-center gap-2 text-sm italic text-muted-foreground">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent/70" />
          {retryAttempt > 0
            ? `finding our flow again… (${retryAttempt})`
            : 'breathing into a response…'}
        </div>
      )}
      <div ref={endRef} />
    </ChatShell>
  );
}

/**
 * True when the most recent assistant message has zero rendered elements —
 * i.e., we've seeded an empty bubble but nothing has streamed yet. Used to
 * gate the "thinking…" placeholder so it only shows during the initial
 * silent window, not alongside tool-call badges.
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

// Detects OpenUI Lang tags in assistant text. UI-2 MVP: just <Picker/>.
// Extend when more components land in packages/ui/src/openui/library.tsx.
const OPENUI_TAG = /<Picker\b/;

function AssistantGroup({
  msgId,
  elements,
  answered,
  onChoice,
  onGoogleSignIn,
  onEmailSignIn,
  onConnectWorkspace,
  onProInterest,
}: {
  msgId: string;
  elements: AssistantElement[];
  answered: boolean;
  onChoice: (msgId: string, answer: string) => void;
  onGoogleSignIn: () => void;
  onEmailSignIn: (email: string) => void;
  onConnectWorkspace: () => void;
  onProInterest: () => void;
}) {
  return (
    <>
      {elements.map((el, i) => {
        const elKey = `${msgId}-${i}-${el.kind}`;
        if (el.kind === 'text') {
          if (OPENUI_TAG.test(el.text)) {
            return (
              <div key={elKey} className="self-start max-w-[90%]">
                <Renderer response={el.text} library={openUILibrary} isStreaming={false} />
              </div>
            );
          }
          return (
            <Bubble key={elKey} from="assistant">
              <Markdown>{el.text}</Markdown>
            </Bubble>
          );
        }
        if (el.kind === 'auth') {
          return (
            <AuthPrompt
              key={elKey}
              mode={el.mode}
              email={el.email}
              disabled={answered}
              onGoogle={onGoogleSignIn}
              onEmail={onEmailSignIn}
            />
          );
        }
        if (el.kind === 'workspace') {
          return <WorkspacePrompt key={elKey} disabled={answered} onConnect={onConnectWorkspace} />;
        }
        if (el.kind === 'upgrade') {
          return <UpgradePrompt key={elKey} disabled={answered} onInterest={onProInterest} />;
        }
        if (el.kind === 'tool-call') {
          return <ToolCallBadge key={elKey} label={el.label} done={el.done} ok={el.ok} />;
        }
        // Legacy tool-call choice path (still supported as fallback).
        return (
          <ChoicePrompt
            key={elKey}
            question={el.question}
            options={el.options}
            single={el.single}
            disabled={answered}
            onSubmit={(answer) => onChoice(msgId, answer)}
          />
        );
      })}
    </>
  );
}
