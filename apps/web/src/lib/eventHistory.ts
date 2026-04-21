/**
 * Converts a Firestore-backed ADK event stream (as returned from
 * GET /api/chat/history) into the chat-UI message shape. Drops
 * internal tool-call/tool-response events — the user never saw those
 * live, so replay hides them too. Choice-picker responses are also
 * dropped since the picker is turn-scoped (already answered).
 */

export interface HistoryUserMessage {
  id: string;
  role: 'user';
  text: string;
}

export interface HistoryAssistantMessage {
  id: string;
  role: 'assistant';
  elements: Array<{ kind: 'text'; text: string }>;
}

export type HistoryMessage = HistoryUserMessage | HistoryAssistantMessage;

interface PartLike {
  text?: string;
  functionCall?: unknown;
  functionResponse?: unknown;
}

interface EventLike {
  id?: string;
  author?: string;
  content?: { role?: string; parts?: PartLike[] };
}

export function eventsToMessages(events: readonly EventLike[]): HistoryMessage[] {
  const out: HistoryMessage[] = [];

  for (const event of events) {
    const parts = event.content?.parts ?? [];
    const textParts = parts.filter((p) => typeof p.text === 'string').map((p) => p.text as string);
    const hasFunctionCall = parts.some((p) => p.functionCall !== undefined);
    const hasFunctionResponse = parts.some((p) => p.functionResponse !== undefined);

    // Skip pure tool-call / tool-response events entirely — those are
    // internal. If an event has BOTH text and a tool call, we keep only the
    // text (rare but possible).
    if (hasFunctionResponse) continue;
    if (textParts.length === 0) continue;
    if (hasFunctionCall && textParts.length === 0) continue;

    const id = event.id ?? randomId();
    const merged = textParts.join('');
    if (event.author === 'user') {
      out.push({ id, role: 'user', text: merged });
    } else if (event.author === 'lifecoach') {
      out.push({ id, role: 'assistant', elements: [{ kind: 'text', text: merged }] });
    }
  }

  return out;
}

function randomId(): string {
  return `h-${Math.random().toString(36).slice(2, 10)}`;
}
