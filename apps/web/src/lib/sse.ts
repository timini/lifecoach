/**
 * Parses an SSE response body into an ordered list of assistant "elements":
 *   - { kind: 'text', text } — concatenated text parts from lifecoach events
 *   - { kind: 'choice', single, question, options } — surfaced by the
 *     ask_single/multiple_choice_question tool's response
 *   - { kind: 'tool-call', id, name, label, done, ok? } — streaming marker
 *     for a tool invocation, surfaced to the UI as a pill badge so the
 *     user sees what the coach is doing while it runs. Replaces the silent
 *     "thinking..." window.
 *
 * The previous shape (parseSseAssistantText → string) is still exported as
 * a thin wrapper so older callers / tests don't break.
 */

export type AssistantElement =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; single: boolean; question: string; options: string[] }
  | { kind: 'auth'; mode: 'google' | 'email'; email?: string }
  | { kind: 'workspace' }
  | { kind: 'upgrade' }
  | {
      kind: 'tool-call';
      id: string;
      /** Internal tool name, for state matching (functionCall.id). */
      name: string;
      /** User-facing label, e.g. "checking your gmail · messages.list". */
      label: string;
      /** true once the matching functionResponse has arrived. */
      done: boolean;
      /** Only meaningful when done=true. Undefined while running. */
      ok?: boolean;
      /** Raw functionCall.args. Surfaced under the badge when expanded so
       * the user can see exactly what the agent passed (debug aid). */
      args?: unknown;
      /** Raw functionResponse.response. Same surface as args — for
       * `update_user_profile` this carries `previous_value`, `new_value`
       * and `modified_at`, which is the user-visible diff. */
      response?: unknown;
    };

export function parseSseAssistant(raw: string): AssistantElement[] {
  const out: AssistantElement[] = [];
  let pendingText = '';

  for (const block of raw.split(/\n\n+/)) {
    if (!block.trim()) continue;
    const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) continue;
    const payload = dataLine.slice('data: '.length);
    if (!payload || payload === '{}') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!isAgentEvent(parsed)) continue;

    // Collect text from lifecoach delta events only. ADK emits a trailing
    // partial=undefined aggregate that duplicates the deltas; skip it.
    if (parsed.author === 'lifecoach' && parsed.partial === true) {
      for (const part of parsed.content?.parts ?? []) {
        if (typeof part.text === 'string') pendingText += part.text;
      }
    }

    // Detect tool responses that surface inline UI (choice pickers, auth
    // prompt). Each response gets its own AssistantElement; order preserved
    // by flushing any pending text first.
    for (const part of parsed.content?.parts ?? []) {
      const fr = part.functionResponse;
      if (!fr) continue;
      const resp = fr.response as
        | {
            status?: string;
            kind?: string;
            question?: string;
            options?: unknown;
            mode?: string;
            email?: string;
          }
        | undefined;

      // Choice pickers.
      if (
        resp?.status === 'shown' &&
        (fr.name === 'ask_single_choice_question' || fr.name === 'ask_multiple_choice_question') &&
        typeof resp.question === 'string' &&
        Array.isArray(resp.options) &&
        resp.options.every((o) => typeof o === 'string')
      ) {
        if (pendingText.trim()) {
          out.push({ kind: 'text', text: pendingText });
          pendingText = '';
        }
        out.push({
          kind: 'choice',
          single: fr.name === 'ask_single_choice_question',
          question: resp.question,
          options: resp.options as string[],
        });
        continue;
      }

      // Auth prompt.
      if (
        resp?.status === 'auth_prompted' &&
        fr.name === 'auth_user' &&
        (resp.mode === 'google' || resp.mode === 'email')
      ) {
        if (pendingText.trim()) {
          out.push({ kind: 'text', text: pendingText });
          pendingText = '';
        }
        out.push({
          kind: 'auth',
          mode: resp.mode,
          ...(typeof resp.email === 'string' ? { email: resp.email } : {}),
        });
      }

      // Workspace connect prompt — LLM emits `connect_workspace` as a UI
      // directive; the client renders the actual OAuth popup button. The
      // response payload has no auth values (see apps/agent/src/tools/
      // connectWorkspace.ts).
      if (resp?.status === 'oauth_prompted' && fr.name === 'connect_workspace') {
        if (pendingText.trim()) {
          out.push({ kind: 'text', text: pendingText });
          pendingText = '';
        }
        out.push({ kind: 'workspace' });
      }

      // Pro upgrade prompt — UI directive. Like connect_workspace, the LLM
      // never sees billing values; the response payload only signals that
      // the upgrade card should render.
      if (resp?.status === 'upgrade_prompted' && fr.name === 'upgrade_to_pro') {
        if (pendingText.trim()) {
          out.push({ kind: 'text', text: pendingText });
          pendingText = '';
        }
        out.push({ kind: 'upgrade' });
      }
    }
  }

  if (pendingText.trim()) out.push({ kind: 'text', text: pendingText });
  return out;
}

/** Back-compat: just the concatenated text. */
export function parseSseAssistantText(raw: string): string {
  return parseSseAssistant(raw)
    .filter((e): e is { kind: 'text'; text: string } => e.kind === 'text')
    .map((e) => e.text)
    .join('');
}

/**
 * A delta reducer for streaming SSE. Feed it one complete `\n\n`-separated
 * block at a time (from a stream reader) and it returns zero or more
 * operations to apply to the current in-progress assistant message.
 *
 * The operations handle:
 *   - appending text as model parts stream in
 *   - pushing a `tool-call` element when a functionCall fires (done=false)
 *   - flipping that same tool-call to done=true when its functionResponse
 *     arrives (matched by fc.id)
 *   - pushing choice / auth / workspace elements from function responses
 */
export type AssistantOp =
  | { op: 'append-text'; text: string }
  | { op: 'push'; element: AssistantElement }
  | { op: 'finish-tool-call'; id: string; ok: boolean; response?: unknown };

export function parseSseBlock(block: string): AssistantOp[] {
  const out: AssistantOp[] = [];
  if (!block.trim()) return out;
  const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return out;
  const payload = dataLine.slice('data: '.length);
  if (!payload || payload === '{}') return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return out;
  }
  if (!isAgentEvent(parsed)) return out;

  const parts = parsed.content?.parts ?? [];

  // Text chunks from the lifecoach author stream in throughout the turn.
  // In streaming mode (StreamingMode.SSE on the agent) ADK emits:
  //   - many `partial: true` events, each carrying a delta chunk, AND
  //   - one trailing event with `partial` left UNDEFINED (not false)
  //     that re-carries the concatenated full text (and sometimes
  //     trailing `emergent_ui:` metadata Gemini bakes in).
  // Appending both doubles the visible reply. We rely on the deltas
  // exclusively — only append text when partial===true. The trailing
  // aggregate is dropped along with any non-streaming legacy events
  // (we don't run in non-streaming mode anymore).
  if (parsed.author === 'lifecoach' && parsed.partial === true) {
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        out.push({ op: 'append-text', text: part.text });
      }
    }
  }

  // functionCall events — emitted when the model decides to run a tool.
  // We push a tool-call element with done=false so the UI can show a
  // running pill.
  for (const part of parts) {
    const fc = part.functionCall;
    if (!fc || typeof fc.name !== 'string') continue;
    out.push({
      op: 'push',
      element: {
        kind: 'tool-call',
        id: fc.id ?? fc.name,
        name: fc.name,
        label: labelForToolCall(fc.name, fc.args),
        done: false,
        args: fc.args,
      },
    });
  }

  // functionResponse events — one per tool completion. We flip the
  // matching in-progress pill to done=true, AND for UI-directive tools
  // (choice / auth / workspace) also push the widget element.
  for (const part of parts) {
    const fr = part.functionResponse;
    if (!fr) continue;
    const resp = fr.response as
      | {
          status?: string;
          kind?: string;
          question?: string;
          options?: unknown;
          mode?: string;
          email?: string;
          code?: string;
        }
      | undefined;

    // Mark the running pill done. ok=false only for real errors.
    // `scope_required` is a recoverable signal — the LLM will follow up
    // with a connect_workspace widget — so we close the pill cleanly
    // rather than flashing red.
    const isScopeRequired = resp?.code === 'scope_required';
    const errored = !isScopeRequired && (resp?.status === 'error' || Boolean(resp?.code));
    out.push({
      op: 'finish-tool-call',
      id: fr.id ?? fr.name ?? 'unknown',
      ok: !errored,
      response: fr.response,
    });

    // Choice pickers.
    if (
      resp?.status === 'shown' &&
      (fr.name === 'ask_single_choice_question' || fr.name === 'ask_multiple_choice_question') &&
      typeof resp.question === 'string' &&
      Array.isArray(resp.options) &&
      resp.options.every((o) => typeof o === 'string')
    ) {
      out.push({
        op: 'push',
        element: {
          kind: 'choice',
          single: fr.name === 'ask_single_choice_question',
          question: resp.question,
          options: resp.options as string[],
        },
      });
      continue;
    }

    // Auth prompt.
    if (
      resp?.status === 'auth_prompted' &&
      fr.name === 'auth_user' &&
      (resp.mode === 'google' || resp.mode === 'email')
    ) {
      out.push({
        op: 'push',
        element: {
          kind: 'auth',
          mode: resp.mode,
          ...(typeof resp.email === 'string' ? { email: resp.email } : {}),
        },
      });
    }

    // Workspace connect prompt.
    if (resp?.status === 'oauth_prompted' && fr.name === 'connect_workspace') {
      out.push({ op: 'push', element: { kind: 'workspace' } });
    }

    // Pro upgrade prompt.
    if (resp?.status === 'upgrade_prompted' && fr.name === 'upgrade_to_pro') {
      out.push({ op: 'push', element: { kind: 'upgrade' } });
    }
  }

  return out;
}

/**
 * User-facing label for a running tool call. Designed to read as "the
 * coach is doing X" — short, specific, no jargon.
 */
export function labelForToolCall(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'call_workspace': {
      const service = typeof a.service === 'string' ? a.service : 'workspace';
      const resource = typeof a.resource === 'string' ? a.resource : '';
      const method = typeof a.method === 'string' ? a.method : '';
      const verb =
        method === 'list'
          ? 'checking'
          : method === 'get'
            ? 'reading'
            : method === 'send'
              ? 'sending'
              : method === 'insert' || method === 'create'
                ? 'creating'
                : method === 'patch' || method === 'modify' || method === 'update'
                  ? 'updating'
                  : method === 'delete' || method === 'trash'
                    ? 'removing'
                    : 'using';
      const subject =
        service === 'gmail'
          ? 'your gmail'
          : service === 'calendar'
            ? 'your calendar'
            : service === 'tasks'
              ? 'your tasks'
              : 'workspace';
      return `${verb} ${subject}${resource ? ` · ${resource}.${method || '*'}` : ''}`;
    }
    case 'update_user_profile': {
      const path = typeof a.path === 'string' ? a.path : '';
      return path ? `remembering ${path}` : 'remembering that';
    }
    case 'log_goal_update': {
      const goal = typeof a.goal === 'string' ? a.goal : '';
      return goal ? `logging goal: ${goal}` : 'logging goal';
    }
    case 'ask_single_choice_question':
    case 'ask_multiple_choice_question':
      return 'showing a choice';
    case 'auth_user':
      return 'offering sign-in';
    case 'connect_workspace':
      return 'offering workspace connect';
    case 'upgrade_to_pro':
      return 'offering pro upgrade';
    case 'memory_save':
      return 'saving memory';
    case 'memory_search':
      return 'recalling';
    case 'google_search':
      return 'searching the web';
    default:
      return `using ${name}`;
  }
}

interface AgentEvent {
  author?: string;
  content?: { parts?: Array<AgentPart> };
  /**
   * ADK streaming flag. `true` on partial delta events; `false` on the
   * final aggregate event (text re-emitted in full). `undefined` in
   * legacy non-streaming mode.
   */
  partial?: boolean;
}
interface AgentPart {
  text?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: unknown;
  };
  functionResponse?: {
    id?: string;
    name?: string;
    response?: unknown;
  };
}

function isAgentEvent(v: unknown): v is AgentEvent {
  return typeof v === 'object' && v !== null;
}
