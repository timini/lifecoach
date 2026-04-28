/**
 * Converts a Firestore-backed ADK event stream (as returned from
 * GET /api/chat/history) into the chat-UI message shape.
 *
 * Tool-call pills for *informational* tools (call_workspace, profile/goal
 * writes, memory ops, search) are emitted with `done: true` so they
 * persist across page navigations. Their `ok` reflects the matched
 * functionResponse (errored vs. successful), with `scope_required`
 * treated as ok — same convention as live streaming in `parseSseBlock`.
 *
 * UI-directive tools (`ask_*_choice_question`, `auth_user`,
 * `connect_workspace`) are dropped — their widget was already user-
 * visible during the live turn; replaying a frozen badge for them adds
 * noise without information.
 *
 * Pure functionResponse-only events are also dropped: they enrich the
 * matching call's status and don't render their own bubble.
 */

import { labelForToolCall } from './sse';

export interface HistoryUserMessage {
  id: string;
  role: 'user';
  text: string;
}

export type HistoryAssistantElement =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool-call';
      id: string;
      name: string;
      label: string;
      done: true;
      ok: boolean;
    };

export interface HistoryAssistantMessage {
  id: string;
  role: 'assistant';
  elements: HistoryAssistantElement[];
}

export type HistoryMessage = HistoryUserMessage | HistoryAssistantMessage;

interface FunctionCallLike {
  id?: string;
  name?: string;
  args?: unknown;
}

interface FunctionResponseLike {
  id?: string;
  name?: string;
  response?: { status?: string; code?: string } & Record<string, unknown>;
}

interface PartLike {
  text?: string;
  functionCall?: FunctionCallLike;
  functionResponse?: FunctionResponseLike;
}

interface EventLike {
  id?: string;
  author?: string;
  content?: { role?: string; parts?: PartLike[] };
}

/**
 * Tools whose pill is meaningful in replay. Anything outside this set is
 * either a UI directive (already rendered as a widget at the time) or a
 * tool we don't expect — both get dropped from history rather than
 * surface a confusing badge.
 */
const REPLAYABLE_TOOLS = new Set<string>([
  'call_workspace',
  'update_user_profile',
  'log_goal_update',
  'memory_save',
  'memory_search',
  'google_search',
]);

function isErrored(fr: FunctionResponseLike | undefined): boolean {
  if (!fr?.response) return false;
  const { status, code } = fr.response;
  // scope_required is recoverable — the LLM follows up with a connect
  // prompt, so the pill should not be error-styled.
  if (code === 'scope_required') return false;
  return status === 'error' || Boolean(code);
}

export function eventsToMessages(events: readonly EventLike[]): HistoryMessage[] {
  // First pass: index every functionResponse by id (or name fallback) so
  // we can pair it with its functionCall when emitting.
  const responsesByKey = new Map<string, FunctionResponseLike>();
  for (const event of events) {
    for (const part of event.content?.parts ?? []) {
      const fr = part.functionResponse;
      if (!fr) continue;
      const key = fr.id ?? fr.name;
      if (key) responsesByKey.set(key, fr);
    }
  }

  const out: HistoryMessage[] = [];

  for (const event of events) {
    const parts = event.content?.parts ?? [];

    // Drop events that contain only functionResponses — they enrich a
    // prior call's pill and have nothing of their own to render.
    const hasAnyText = parts.some((p) => typeof p.text === 'string' && p.text.length > 0);
    const hasAnyCall = parts.some((p) => p.functionCall !== undefined);
    if (!hasAnyText && !hasAnyCall) continue;

    const elements: HistoryAssistantElement[] = [];
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        const last = elements[elements.length - 1];
        if (last?.kind === 'text') {
          last.text += part.text;
        } else {
          elements.push({ kind: 'text', text: part.text });
        }
      }

      const fc = part.functionCall;
      if (fc?.name && REPLAYABLE_TOOLS.has(fc.name)) {
        const id = fc.id ?? fc.name;
        const matched = responsesByKey.get(id);
        elements.push({
          kind: 'tool-call',
          id,
          name: fc.name,
          label: labelForToolCall(fc.name, fc.args),
          done: true,
          ok: !isErrored(matched),
        });
      }
    }

    if (elements.length === 0) continue;

    const id = event.id ?? randomId();
    if (event.author === 'user') {
      const text = elements
        .filter((e): e is { kind: 'text'; text: string } => e.kind === 'text')
        .map((e) => e.text)
        .join('');
      if (text) out.push({ id, role: 'user', text });
    } else if (event.author === 'lifecoach') {
      out.push({ id, role: 'assistant', elements });
    }
  }

  return out;
}

function randomId(): string {
  return `h-${Math.random().toString(36).slice(2, 10)}`;
}
