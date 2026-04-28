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
  ToolCallBadge,
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
  sendEmailSignInLink,
  signOutCurrent,
} from '../lib/firebase';
import {
  type BrowserLocation,
  getLocationPermissionState,
  requestBrowserLocation,
} from '../lib/geolocation';
import { type AssistantElement, type AssistantOp, parseSseBlock } from '../lib/sse';
import { connectWorkspace } from '../lib/workspace';

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

function ensureSessionId(): string {
  const KEY = 'lifecoach.sessionId';
  if (typeof window === 'undefined') return 'ssr';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [location, setLocation] = useState<BrowserLocation | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const [sessionId, setSessionId] = useState<string>(() => ensureSessionId());

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

  /**
   * Fetches the canonical Firestore-backed transcript for this session.
   * Used both on initial mount and as the recovery path when the SSE
   * stream from /api/chat is interrupted mid-flight — the agent usually
   * completes and persists even when the browser drops the connection,
   * so re-pulling history is a safe, idempotent way to surface the real
   * outcome without double-sending the user's message.
   */
  const fetchAndApplyHistory = useCallback(async (): Promise<Message[] | null> => {
    if (!user) return null;
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
    (async () => {
      const rehydrated = await fetchAndApplyHistory();
      if (cancelled || !rehydrated || rehydrated.length === 0) return;
      setMessages(rehydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, fetchAndApplyHistory]);

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

  async function sendText(text: string) {
    if (!text.trim() || busy || !user) return;
    setInput('');
    setBusy(true);
    setMessages((prev) => [...prev, { id: messageId(), role: 'user', text }]);

    const assistantId = messageId();
    // Seed an empty assistant message immediately so streaming ops can
    // update it in place instead of racing to create it.
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', elements: [] }]);

    try {
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
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Split on blank-line SSE separators; keep trailing partial.
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            applyOps(assistantId, parseSseBlock(block));
          }
        }
        // Flush any remaining buffered block.
        if (buffer.trim()) applyOps(assistantId, parseSseBlock(buffer));
      }

      // If the final assistant message has no rendered content, swap in
      // a terse placeholder so the user isn't staring at an empty turn.
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId || m.role !== 'assistant') return m;
          const visible = m.elements.some(
            (el) => el.kind !== 'tool-call' || (el.kind === 'tool-call' && el.done && el.ok),
          );
          if (visible) return m;
          return {
            ...m,
            elements: [{ kind: 'text', text: '(no response — check agent logs)' }],
          };
        }),
      );
    } catch (err) {
      // Stream broke. Most often the agent still completed and saved
      // events to Firestore — refetch /history and check whether our
      // user message is in there with at least one assistant turn after
      // it. If yes, that transcript is the truth; swap it in. If no,
      // the request never reached the agent, so surface the raw error
      // so the user can manually retry.
      const rehydrated = await fetchAndApplyHistory();
      const ourMessageLanded = rehydrated?.some(
        (m, i) =>
          m.role === 'user' &&
          m.text === text &&
          rehydrated.slice(i + 1).some((later) => later.role === 'assistant'),
      );
      if (rehydrated && ourMessageLanded) {
        setMessages(rehydrated);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.role === 'assistant'
              ? { ...m, elements: [...m.elements, { kind: 'text', text: `error: ${msg}` }] }
              : m,
          ),
        );
      }
    } finally {
      setBusy(false);
    }
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
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('lifecoach.sessionId');
      }
      setSessionId(ensureSessionId());
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
      await connectWorkspace(user);
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
  });
  const userState = stateMachine.current();
  const affordances = stateMachine
    .policy()
    .uiAffordances.map((a) => a.kind) as AccountMenuAffordance[];

  const header = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Lifecoach</h1>
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
      <div className="flex items-center justify-end">
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

  const footer = (
    <form
      className="flex gap-2"
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
      <Button type="submit" disabled={busy || !input.trim()} size="lg">
        Send
      </Button>
    </form>
  );

  return (
    <ChatShell header={header} footer={footer}>
      {messages.length === 0 && (
        <div className="text-sm text-muted-foreground">
          Say hi to get started. The coach is warming up.
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
          />
        );
      })}
      {busy && lastAssistantHasNoContent(messages) && (
        <div className="text-sm italic text-muted-foreground">thinking…</div>
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
}: {
  msgId: string;
  elements: AssistantElement[];
  answered: boolean;
  onChoice: (msgId: string, answer: string) => void;
  onGoogleSignIn: () => void;
  onEmailSignIn: (email: string) => void;
  onConnectWorkspace: () => void;
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
              {el.text}
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
