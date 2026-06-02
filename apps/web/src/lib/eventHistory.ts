/**
 * Converts a Firestore-backed ADK event stream (as returned from
 * GET /api/chat/history) into the chat-UI message shape.
 *
 * Tool-call pills for *informational* tools (workspace, profile/goal
 * writes, memory ops, search) are emitted with `done: true` so they
 * persist across page navigations. Their `ok` reflects the matched
 * functionResponse (errored vs. successful), with `scope_required`
 * treated as ok — same convention as live streaming in `parseSseBlock`.
 *
 * UI-directive tools (`ask_*_choice_question`, `auth_user`,
 * `connect_workspace`, `upgrade_to_pro`) are dropped — their widget was
 * already user-visible during the live turn; replaying a frozen badge
 * for them adds noise without information.
 *
 * Pure functionResponse-only events are also dropped: they enrich the
 * matching call's status and don't render their own bubble.
 */

import { labelForToolCall, stripWorkspaceBridgeMetadata, workspaceParentIdFromArgs } from './sse';

/** Author tag stamped onto bridged workspace sub-agent events by
 * `BridgedAgentTool`. Different from `lifecoach` so ADK's contents
 * builder treats them as foreign — kept in sync with
 * `WORKSPACE_BRIDGE_AUTHOR` in `bridged_agent_tool.py`. */
const WORKSPACE_BRIDGE_AUTHOR = 'lifecoach-workspace-bridge';

export interface HistoryUserMessage {
  id: string;
  role: 'user';
  text: string;
  /** Unix-ms timestamp drawn from `event.timestamp` (seconds) when present;
   * falls back to 0 so callers always have a numeric value to render. */
  timestamp: number;
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
      /** Original args from functionCall — surfaced when the badge is
       * expanded. Undefined when rehydrating older events that didn't
       * persist args. */
      args?: unknown;
      /** Original response from functionResponse — same surface as args. */
      response?: unknown;
      /** Set when this is a bridged workspace sub-agent call. Used by
       * the renderer to nest the badge under its parent. */
      parentId?: string;
      /** Nested bridged sub-agent calls. Populated during rehydration
       * when this badge is an outer AgentTool with bridged children. */
      children?: HistoryAssistantElement[];
    };

export interface HistoryAssistantMessage {
  id: string;
  role: 'assistant';
  elements: HistoryAssistantElement[];
  timestamp: number;
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
  /**
   * Wall-clock when the event was created. Unit is unfortunately ambiguous
   * across ADK versions and across our own synthesised events: some are
   * seconds-since-epoch (Python ADK convention, our `makeRecoveryEvent`),
   * others are milliseconds (TS ADK 0.6.1 runtime). Normalised to ms via
   * `normaliseEventTimestamp` below.
   */
  timestamp?: number;
  content?: { role?: string; parts?: PartLike[] };
  /** Set by `BridgedAgentTool` so bridged sub-agent events carry their
   * outer AgentTool's function_call_id. The FE keys on this to nest
   * inner badges under the parent in /history rehydration. */
  customMetadata?: { parentToolCallId?: string };
}

/**
 * Normalise an event timestamp to milliseconds-since-epoch. Heuristic:
 * any value < 1e12 is treated as seconds (1e12 seconds is year ~33658, so
 * any real second-epoch number is well under that), anything else is
 * treated as already-ms. Returns 0 on missing / NaN so the formatter can
 * swallow it as "no timestamp" rather than rendering year 1970 text.
 */
export function normaliseEventTimestamp(t: number | undefined): number {
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return 0;
  return t < 1e12 ? Math.floor(t * 1000) : Math.floor(t);
}

/**
 * Tools whose pill is meaningful in replay. Anything outside this set is
 * either a UI directive (already rendered as a widget at the time) or a
 * tool we don't expect — both get dropped from history rather than
 * surface a confusing badge.
 */
const REPLAYABLE_TOOLS = new Set<string>([
  // Workspace surface — main agent's tools when workspace_connected
  'triage_inbox',
  'find_workspace',
  'archive_messages',
  'add_calendar_event',
  'edit_calendar_event',
  'delete_calendar_event',
  'add_task',
  'complete_task',
  'update_user_profile',
  'log_goal_update',
  'memory_save',
  'memory_search',
  'google_search',
  // Bridged workspace sub-agent inner tools. Rendered as nested
  // badges under their parent AgentTool when replayed.
  'list_inbox',
  'get_message',
  'search_messages',
  'list_events',
  'list_tasks',
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
  // Bridged child tool-calls that arrived before their parent
  // AgentTool's badge was emitted. The parent is appended later in the
  // event stream; we attach pending children when we see it.
  const pendingChildrenByParent = new Map<string, HistoryAssistantElement[]>();

  for (const event of events) {
    const parts = event.content?.parts ?? [];

    // Drop events that contain only functionResponses — they enrich a
    // prior call's pill and have nothing of their own to render.
    const hasAnyText = parts.some((p) => typeof p.text === 'string' && p.text.length > 0);
    const hasAnyCall = parts.some((p) => p.functionCall !== undefined);
    if (!hasAnyText && !hasAnyCall) continue;

    // Bridged workspace events: persisted under the bridge author so
    // ADK doesn't replay them as main-agent tool calls (see
    // `WORKSPACE_BRIDGE_AUTHOR` in bridged_agent_tool.py). They carry a
    // `customMetadata.parentToolCallId` pointing at their outer
    // AgentTool's function_call_id. Render them as nested children of
    // that parent rather than as flat messages.
    const eventParentId =
      event.author === WORKSPACE_BRIDGE_AUTHOR
        ? (event.customMetadata?.parentToolCallId ?? undefined)
        : undefined;

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
        // Parent linkage may live on the event (customMetadata, set by
        // BridgedAgentTool) or inside the args (the bridge also stamps
        // `__parentToolCallId` into args so the link survives even if
        // customMetadata is ever dropped by an intermediate writer).
        const parentId = eventParentId ?? workspaceParentIdFromArgs(fc.args);
        const element: HistoryAssistantElement = {
          kind: 'tool-call',
          id,
          name: fc.name,
          label: labelForToolCall(fc.name, fc.args),
          done: true,
          ok: !isErrored(matched),
          args: stripWorkspaceBridgeMetadata(fc.args),
          response: stripWorkspaceBridgeMetadata(matched?.response),
          ...(parentId ? { parentId } : {}),
        };
        if (parentId) {
          // Child — attach under the parent if we've already emitted
          // it, otherwise stash it until the parent shows up.
          if (!attachHistoryChild(out, elements, parentId, element)) {
            const queue = pendingChildrenByParent.get(parentId) ?? [];
            queue.push(element);
            pendingChildrenByParent.set(parentId, queue);
          }
        } else {
          // Parent (or non-bridged). Pull in any orphans we've stashed
          // waiting for this id.
          const pendingChildren = pendingChildrenByParent.get(id);
          if (pendingChildren) {
            elements.push({ ...element, children: pendingChildren });
            pendingChildrenByParent.delete(id);
          } else {
            elements.push(element);
          }
        }
      }
    }

    if (elements.length === 0) continue;

    // Bridged events have already been attached under their parents
    // (or stashed). Don't emit them as standalone messages.
    if (event.author === WORKSPACE_BRIDGE_AUTHOR) continue;

    const id = event.id ?? randomId();
    const timestamp = normaliseEventTimestamp(event.timestamp);
    if (event.author === 'user') {
      const text = elements
        .filter((e): e is { kind: 'text'; text: string } => e.kind === 'text')
        .map((e) => e.text)
        .join('');
      // First-of-day kickoff sentinel: a hidden user event the web app
      // sends to wake the agent on a fresh session. Filtered here so the
      // greeting bubble appears with no preceding user bubble.
      if (text === '__session_start__') continue;
      if (text) out.push({ id, role: 'user', text, timestamp });
    } else if (event.author === 'lifecoach') {
      out.push({ id, role: 'assistant', elements, timestamp });
    }
  }

  return out;
}

/** Walk current + emitted assistant messages and attach a bridged child
 * tool-call under its parent (`parentId`). Returns true when the parent
 * was found and the child was attached. */
function attachHistoryChild(
  messages: HistoryMessage[],
  currentElements: HistoryAssistantElement[],
  parentId: string,
  child: HistoryAssistantElement,
): boolean {
  const attach = (elements: HistoryAssistantElement[]): boolean => {
    for (const el of elements) {
      if (el.kind !== 'tool-call') continue;
      if (el.id === parentId) {
        el.children = [...(el.children ?? []), child];
        return true;
      }
      if (el.children && attach(el.children)) return true;
    }
    return false;
  };
  if (attach(currentElements)) return true;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'assistant' && attach(msg.elements)) return true;
  }
  return false;
}

function randomId(): string {
  return `h-${Math.random().toString(36).slice(2, 10)}`;
}
