'use client';

import type { User } from 'firebase/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { eventsToMessages } from '../lib/eventHistory';
import { ensureSignedIn } from '../lib/firebase';
import { type BrowserLocation, requestBrowserLocation } from '../lib/geolocation';
import { type AssistantElement, parseSseAssistant } from '../lib/sse';
import { ChoicePrompt } from './ChoicePrompt';

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

  // On sign-in settle, rehydrate previous messages from the agent's
  // Firestore-backed session store (not localStorage — the agent is the
  // source of truth and that history survives Cloud Run restarts + device
  // changes for a given Firebase UID).
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
        // best-effort; chat still works without history
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

  function submitChoice(messageId: string, answer: string) {
    // Mark the assistant message containing the choice as answered so the
    // widget disables itself after selection. Then send the selection as a
    // normal chat message.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === 'assistant' ? { ...m, answered: true } : m,
      ),
    );
    void sendText(answer);
  }

  if (authError) {
    return (
      <section style={{ color: '#f87171' }}>
        Sign-in failed: {authError}. Check NEXT_PUBLIC_FIREBASE_* env vars.
      </section>
    );
  }

  if (!user) {
    return <section style={{ color: '#888', fontSize: 14 }}>Signing you in…</section>;
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '1rem' }}>
      <div
        style={{
          fontSize: 12,
          color: '#666',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          Signed in{user.isAnonymous ? ' anonymously' : ''} as {user.uid.slice(0, 12)}…
        </span>
        {location ? (
          <span style={{ color: '#4ade80' }}>📍 location shared</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              void shareLocation();
            }}
            disabled={locationRequested}
            style={{
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid #334',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
            }}
          >
            {locationRequested ? 'no location' : 'Share location'}
          </button>
        )}
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 4,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: '#666', fontSize: 14 }}>
            Say hi to get started. The coach is warming up.
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') return <UserBubble key={m.id} text={m.text} />;
          return (
            <AssistantBubbleGroup
              key={m.id}
              msgId={m.id}
              elements={m.elements}
              answered={Boolean(m.answered)}
              onChoice={submitChoice}
            />
          );
        })}
        {busy && <div style={{ color: '#888', fontSize: 14, fontStyle: 'italic' }}>thinking…</div>}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendText(input);
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={busy}
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #334',
            background: '#1e293b',
            color: '#e8e8e8',
            fontSize: 16,
          }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#2563eb',
            color: 'white',
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy || !input.trim() ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </form>
    </section>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        alignSelf: 'flex-end',
        background: '#2563eb',
        color: 'white',
        padding: '8px 12px',
        borderRadius: 12,
        maxWidth: '80%',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.4,
      }}
    >
      {text}
    </div>
  );
}

function AssistantBubbleGroup({
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
          return (
            <div
              key={elKey}
              style={{
                alignSelf: 'flex-start',
                background: '#1e293b',
                color: '#e8e8e8',
                padding: '8px 12px',
                borderRadius: 12,
                maxWidth: '80%',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.4,
              }}
            >
              {el.text}
            </div>
          );
        }
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
