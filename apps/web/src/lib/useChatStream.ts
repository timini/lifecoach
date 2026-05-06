'use client';

import type { User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { eventsToMessages } from './eventHistory';
import type { BrowserLocation } from './geolocation';
import { captureChatEvent } from './sentry';
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
  retryAttempt: number;
  sendText: (text: string, opts?: { hidden?: boolean }) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  appendAssistantText: (text: string) => void;
  markAnswered: (mid: string) => void;
}

/**
 * Owns the chat transcript state and the SSE round-trip with /api/chat. Pulls
 * the streaming body, applies ops to the assistant bubble, retries on
 * pre-headers blips, and falls back to /api/chat/history rehydration when the
 * stream lands empty (the empty-thought-turn surface).
 *
 * Auth, location, sessionId, and viewMode are inputs — the page owns those.
 */
export function useChatStream({
  user,
  sessionId,
  viewMode,
  location,
}: UseChatStreamArgs): UseChatStreamApi {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  // 0 = first attempt in flight (or idle). 1+ = currently retrying after a
  // network blip. Drives the "retrying…" indicator copy.
  const [retryAttempt, setRetryAttempt] = useState(0);

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

      const MAX_RETRIES = 2;
      let succeeded = false;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          setRetryAttempt(attempt);
          await new Promise((r) => setTimeout(r, 600 * attempt));
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
        }
      }
      setRetryAttempt(0);

      if (succeeded) {
        const isVisible = (els: AssistantElement[]) =>
          els.some(
            (el) => el.kind !== 'tool-call' || (el.kind === 'tool-call' && el.done && el.ok),
          );
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
            captureChatEvent('chat.empty_turn_fallback_shown', {
              sessionId,
              uid: user?.uid ?? null,
              lastUserText: text,
              rehydrationHadOurMessage: Boolean(rehydrated && !ourMessageLanded),
              historyEventCount: rehydrated?.length ?? 0,
            });
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
        captureChatEvent('chat.retry_exhausted', {
          sessionId,
          uid: user?.uid ?? null,
          lastUserText: text,
        });
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
    },
    [user, sessionId, viewMode, location, busy, applyOps, fetchAndApplyHistory],
  );

  // sendText is memoised on `busy`, so its identity flips on every send.
  // Stash the latest function in a ref and call through that — the
  // transcript-load effect below must NOT re-run on busy transitions or it
  // would `setMessages([])` mid-stream and clobber the in-flight reply.
  const sendTextRef = useRef(sendText);
  useEffect(() => {
    sendTextRef.current = sendText;
  }, [sendText]);

  // Initial transcript load + first-of-day kickoff. Clears stale state from a
  // previous uid before the new history lands. Deliberately omits sendText
  // from the deps — see sendTextRef above.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setMessages([]);
    (async () => {
      const rehydrated = await fetchAndApplyHistory();
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
  }, [user, fetchAndApplyHistory, sessionId, viewMode]);

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
    retryAttempt,
    sendText,
    setMessages,
    appendAssistantText,
    markAnswered,
  };
}
