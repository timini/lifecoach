'use client';

import { Bubble, Button, ChatShell, ChoicePrompt, Input, LocationBadge } from '@lifecoach/ui';
import { Renderer, library as openUILibrary } from '@lifecoach/ui/openui';
import type { User } from 'firebase/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { eventsToMessages } from '../lib/eventHistory';
import { ensureSignedIn } from '../lib/firebase';
import { type BrowserLocation, requestBrowserLocation } from '../lib/geolocation';
import { type AssistantElement, parseSseAssistant } from '../lib/sse';

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

  const sessionId = useMemo(() => ensureSessionId(), []);

  useEffect(() => {
    ensureSignedIn()
      .then(setUser)
      .catch((err: unknown) => setAuthError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/chat/history?userId=${encodeURIComponent(user.uid)}&sessionId=${encodeURIComponent(sessionId)}`,
          { headers: { authorization: `Bearer ${idToken}` } },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { events?: unknown[] };
        if (cancelled) return;
        const rehydrated: Message[] = eventsToMessages((body.events ?? []) as never).map((m) =>
          m.role === 'user'
            ? { id: m.id, role: 'user', text: m.text }
            : { id: m.id, role: 'assistant', elements: m.elements, answered: true },
        );
        if (rehydrated.length > 0) setMessages(rehydrated);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, sessionId]);

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
      const raw = await res.text();
      const elements = parseSseAssistant(raw);
      if (elements.length === 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: messageId(),
            role: 'assistant',
            elements: [{ kind: 'text', text: '(no response — check agent logs)' }],
          },
        ]);
      } else {
        setMessages((prev) => [...prev, { id: messageId(), role: 'assistant', elements }]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId(),
          role: 'assistant',
          elements: [{ kind: 'text', text: `error: ${msg}` }],
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function submitChoice(mid: string, answer: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === mid && m.role === 'assistant' ? { ...m, answered: true } : m)),
    );
    void sendText(answer);
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

  const header = (
    <>
      <h1 className="text-lg font-semibold">Lifecoach</h1>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Signed in{user.isAnonymous ? ' anonymously' : ''} as {user.uid.slice(0, 12)}…
        </span>
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
          />
        );
      })}
      {busy && <div className="text-sm italic text-muted-foreground">thinking…</div>}
      <div ref={endRef} />
    </ChatShell>
  );
}

// Detects OpenUI Lang tags in assistant text. UI-2 MVP: just <Picker/>.
// Extend when more components land in packages/ui/src/openui/library.tsx.
const OPENUI_TAG = /<Picker\b/;

function AssistantGroup({
  msgId,
  elements,
  answered,
  onChoice,
}: {
  msgId: string;
  elements: AssistantElement[];
  answered: boolean;
  onChoice: (msgId: string, answer: string) => void;
}) {
  return (
    <>
      {elements.map((el, i) => {
        const elKey = `${msgId}-${i}-${el.kind}`;
        if (el.kind === 'text') {
          // Generative-UI path: if the assistant emitted an OpenUI tag,
          // let the Renderer draw the real components. Otherwise, plain
          // text goes into a bubble as before.
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
        // Legacy tool-call choice path — still supported as a fallback
        // for when the model goes via ask_single_choice_question instead
        // of emitting OpenUI Lang.
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
