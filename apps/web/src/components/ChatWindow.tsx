'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSseAssistantText } from '../lib/sse';

type Role = 'user' | 'assistant';
interface Message {
  id: string;
  role: Role;
  text: string;
}

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

function ensureAnonUserId(): string {
  // Phase 2 replaces this with Firebase anonymous auth. For Phase 1 we need
  // *some* stable id so the agent sees the same session across refreshes.
  const KEY = 'lifecoach.anonUserId';
  if (typeof window === 'undefined') return 'ssr';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = `anon-${crypto.randomUUID()}`;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const ids = useMemo(
    () => ({
      userId: ensureAnonUserId(),
      sessionId: ensureSessionId(),
    }),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: rescroll whenever messages/busy change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMessages((prev) => [...prev, { id: messageId(), role: 'user', text }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...ids, message: text }),
      });
      const raw = await res.text();
      const reply = parseSseAssistantText(raw);
      if (reply) {
        setMessages((prev) => [...prev, { id: messageId(), role: 'assistant', text: reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: messageId(), role: 'assistant', text: '(no response — check agent logs)' },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        { id: messageId(), role: 'assistant', text: `error: ${msg}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: '1rem',
      }}
    >
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
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              background: m.role === 'user' ? '#2563eb' : '#1e293b',
              color: m.role === 'user' ? 'white' : '#e8e8e8',
              padding: '8px 12px',
              borderRadius: 12,
              maxWidth: '80%',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.4,
            }}
          >
            {m.text}
          </div>
        ))}
        {busy && <div style={{ color: '#888', fontSize: 14, fontStyle: 'italic' }}>thinking…</div>}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
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
