'use client';

import type { User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { eventsToMessages } from './eventHistory';
import type { BrowserLocation } from './geolocation';
import { type AssistantElement, type AssistantOp, parseSseBlock } from './sse';

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  timestamp: number;
}
export interface AssistantMessage {
  id: string;
  role: 'assistant';
  elements: AssistantElement[];
  answered?: boolean;
  timestamp: number;
}
export type Message = UserMessage | AssistantMessage;

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseChatStreamArgs {
  user: User | null;
  sessionId: string;
  viewMode: 'live' | 'past';
  location: BrowserLocation | null;
}

export interface UseChatStreamApi {
  messages: Message[];
  busy: boolean;
  sendText: (text: string, opts?: { hidden?: boolean }) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  appendAssistantText: (text: string) => void;
  markAnswered: (mid: string) => void;
}

/**
 * Owns the chat transcript state and the SSE round-trip with /api/chat. One
 * attempt per turn: send, stream events into the assistant bubble, done.
 * No retries, no fallback copy: if the request errors or the stream ends
 * with no content, the bubble stays empty and the user retypes.
 *
 * Auth, location, sessionId, and viewMode are inputs — the page owns those.
 */

/** Attach a bridged workspace child tool-call under its parent.
 * Walks the tree recursively because parents can themselves be nested
 * (we currently render only one level of nesting in chat-stream, but
 * the data shape supports deeper). If no parent is found yet the child
 * is dropped — the bridged event always arrives after the parent's
 * push op in the live stream because BridgedAgentTool can only emit
 * once ADK has started the outer AgentTool run. The history path
 * (`eventsToMessages`) handles child-before-parent rehydration. */
function attachChildToolCall(
  elements: AssistantElement[],
  parentId: string,
  child: AssistantElement,
): AssistantElement[] {
  let found = false;
  const next = elements.map((el) => {
    if (el.kind !== 'tool-call') return el;
    if (el.id === parentId) {
      found = true;
      return { ...el, children: [...(el.children ?? []), child] };
    }
    if (el.children) {
      const recursed = attachChildToolCall(el.children, parentId, child);
      if (recursed !== el.children) {
        found = true;
        return { ...el, children: recursed };
      }
    }
    return el;
  });
  // Fallback: if no parent was found (live event arrived before its
  // outer AgentTool's push op — should not happen, but safe-guard so
  // the badge doesn't disappear) append flat.
  return found ? next : [...elements, child];
}

/** Flip the matching tool-call (possibly nested) to done. When
 * `op.parentId` is set we scope the search to that branch so two
 * sub-agent calls with the same `name`-based id don't collide. */
function finishToolCall(
  elements: AssistantElement[],
  op: Extract<AssistantOp, { op: 'finish-tool-call' }>,
): AssistantElement[] {
  return elements.map((el) => {
    if (el.kind !== 'tool-call') return el;
    if (el.id === op.id && !el.done && (!op.parentId || el.parentId === op.parentId)) {
      return { ...el, done: true, ok: op.ok, response: op.response };
    }
    if (el.children) {
      return { ...el, children: finishToolCall(el.children, op) };
    }
    return el;
  });
}

export function useChatStream({
  user,
  sessionId,
  viewMode,
  location,
}: UseChatStreamArgs): UseChatStreamApi {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);

  // Tracks sessionIds we've already kicked off in this tab — guards against
  // double-firing on StrictMode re-runs of the history-load effect.
  const kickedOffRef = useRef<Set<string>>(new Set());

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
          ? { id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }
          : {
              id: m.id,
              role: 'assistant',
              elements: m.elements,
              answered: true,
              timestamp: m.timestamp,
            },
      );
      return rehydrated;
    } catch {
      return null;
    }
  }, [user, sessionId]);

  const applyOps = useCallback((msgId: string, ops: AssistantOp[]) => {
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
            if (op.element.kind === 'tool-call' && op.element.parentId) {
              // Bridged workspace sub-agent call: nest under its
              // parent AgentTool badge instead of pushing flat.
              elements = attachChildToolCall(elements, op.element.parentId, op.element);
            } else {
              elements = [...elements, op.element];
            }
          } else if (op.op === 'finish-tool-call') {
            elements = finishToolCall(elements, op);
          }
        }
        return { ...m, elements };
      }),
    );
  }, []);

  const sendText = useCallback(
    async (text: string, opts?: { hidden?: boolean }) => {
      if (!text.trim() || busy || !user || !sessionId || viewMode === 'past') return;
      const hidden = opts?.hidden === true;
      setBusy(true);
      const now = Date.now();
      if (!hidden) {
        setMessages((prev) => [...prev, { id: messageId(), role: 'user', text, timestamp: now }]);
      }

      const assistantId = messageId();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', elements: [], timestamp: Date.now() },
      ]);

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

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { detail?: string };
          let detail: string | null = null;
          if (body.detail) {
            try {
              const parsed = JSON.parse(body.detail) as { message?: unknown };
              detail = typeof parsed.message === 'string' ? parsed.message : null;
            } catch {
              detail = null;
            }
          }
          const message = detail ?? 'Chat limit reached. Please try again later.';
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.role === 'assistant'
                ? { ...m, elements: [{ kind: 'text', text: message }], answered: true }
                : m,
            ),
          );
        } else if (!res.body) {
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
            const blocks = buffer.split(/\n\n/);
            buffer = blocks.pop() ?? '';
            for (const block of blocks) {
              applyOps(assistantId, parseSseBlock(block));
            }
          }
          if (buffer.trim()) applyOps(assistantId, parseSseBlock(buffer));
        }
      } catch {
        // Network / fetch failure. The assistant bubble stays empty;
        // user can retype.
      }

      setBusy(false);
    },
    [user, sessionId, viewMode, location, busy, applyOps],
  );

  // sendText is memoised on `busy`, so its identity flips on every send.
  // Stash the latest function in a ref and call through that — the
  // transcript-load effect below must NOT re-run on busy transitions or it
  // would `setMessages([])` mid-stream and clobber the in-flight reply.
  const sendTextRef = useRef(sendText);
  useEffect(() => {
    sendTextRef.current = sendText;
  }, [sendText]);

  // Same shape for fetchAndApplyHistory — it's memoised on [user, sessionId],
  // and the firebase User reference can flip on token refresh even when the
  // uid hasn't changed. If we put fetchAndApplyHistory in the load-effect's
  // deps directly, a token-refresh-driven user-ref flip retriggers the
  // effect, `setMessages([])` wipes the in-flight transcript, and the
  // /history refetch races the agent's just-completed turn — the streamed
  // reply visibly "flashes" then disappears. Route via a ref + key the
  // effect on stable primitives (uid + sessionId + viewMode) instead.
  const fetchHistoryRef = useRef(fetchAndApplyHistory);
  useEffect(() => {
    fetchHistoryRef.current = fetchAndApplyHistory;
  }, [fetchAndApplyHistory]);

  // Initial transcript load + first-of-day kickoff. Clears stale state from a
  // previous uid before the new history lands. Keyed on uid (not the full
  // User object) so token refresh doesn't clobber the in-flight reply.
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setMessages([]);
    (async () => {
      const rehydrated = await fetchHistoryRef.current();
      if (cancelled) return;
      if (rehydrated && rehydrated.length > 0) {
        setMessages(rehydrated);
        return;
      }
      if (
        viewMode === 'live' &&
        sessionId &&
        !kickedOffRef.current.has(sessionId) &&
        rehydrated !== null
      ) {
        kickedOffRef.current.add(sessionId);
        void sendTextRef.current('__session_start__', { hidden: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, sessionId, viewMode]);

  const appendAssistantText = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: messageId(),
        role: 'assistant',
        elements: [{ kind: 'text', text }],
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const markAnswered = useCallback((mid: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === mid && m.role === 'assistant' ? { ...m, answered: true } : m)),
    );
  }, []);

  return {
    messages,
    busy,
    sendText,
    setMessages,
    appendAssistantText,
    markAnswered,
  };
}
