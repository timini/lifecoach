'use client';

import { useState } from 'react';
import { Spinner } from '../atoms/spinner';
import { AuthPrompt } from '../molecules/auth-prompt';
import { Bubble } from '../molecules/bubble';
import type { CapabilityCta } from '../molecules/capability-tile';
import { ChoicePrompt } from '../molecules/choice-prompt';
import { ToolCallBadge } from '../molecules/tool-call-badge';
import { UpgradePrompt } from '../molecules/upgrade-prompt';
import { type WallCta, WallPrompt, type WallReason } from '../molecules/wall-prompt';
import { WorkspacePrompt } from '../molecules/workspace-prompt';
import { Renderer, library as openUILibrary } from '../openui/library';
import { CapabilityPicker, type CapabilityPickerTile } from './capability-picker';
import { Markdown } from './markdown';

export type ChatStreamElement =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; single: boolean; question: string; options: string[] }
  | { kind: 'auth'; mode: 'google' | 'email'; email?: string }
  | { kind: 'workspace' }
  | { kind: 'upgrade' }
  | { kind: 'wall'; reason: WallReason; cta: WallCta }
  | { kind: 'capabilities'; tiles: CapabilityPickerTile[] }
  | {
      kind: 'tool-call';
      id: string;
      name: string;
      label: string;
      done: boolean;
      ok?: boolean;
      /** Raw args / response surfaced under the badge when the user
       * expands it (debug aid). Optional because older rehydrated
       * events won't have them. */
      args?: unknown;
      response?: unknown;
      /** For bridged workspace sub-agent calls, the outer AgentTool
       * call id. Used by `ToolCallElement` to render the indented
       * connector line under the parent. */
      parentId?: string;
      /** Nested bridged workspace sub-agent badges (one level deep
       * in practice — triage_inbox / find_workspace wrap a sub-agent
       * that only ever calls Gmail / Calendar / Tasks). */
      children?: ChatStreamElement[];
    };

export interface ChatStreamUserMessage {
  id: string;
  role: 'user';
  text: string;
  /** Unix-ms timestamp; surfaces as a muted time label under the bubble. */
  timestamp?: number;
}
export interface ChatStreamAssistantMessage {
  id: string;
  role: 'assistant';
  elements: ChatStreamElement[];
  answered?: boolean;
  /** Unix-ms timestamp; surfaces as a muted time label under the bubble. */
  timestamp?: number;
}
export type ChatStreamMessage = ChatStreamUserMessage | ChatStreamAssistantMessage;

export interface ChatStreamProps {
  messages: ChatStreamMessage[];
  /**
   * Show a "thinking…" indicator below the last message. Caller decides
   * when (typically: busy && last assistant bubble has no content).
   */
  pending?: boolean;
  /** Optional copy override for the pending row. */
  pendingLabel?: string;
  onChoice: (msgId: string, answer: string) => void;
  onGoogleSignIn: () => void;
  onEmailSignIn: (email: string) => void;
  onConnectWorkspace: () => void;
  onProInterest: () => void;
  /** Fired when the wall card's CTA is `auth_user` and the user clicks
   * "Sign in with Google". Defaults to `onGoogleSignIn` if omitted. */
  onWallAuthUser?: () => void;
  /** Fired when the wall card's CTA is `upgrade_to_pro` and the user
   * clicks "I'm interested in Pro". Defaults to `onProInterest`. */
  onWallUpgradeToPro?: () => void;
  /**
   * Fired when a capability-picker tile's Connect button is clicked.
   * Caller dispatches the relevant flow ('connect_workspace' →
   * onConnectWorkspace, 'connect_notion' → notion oauth popup). If
   * omitted, the renderer routes `connect_workspace` through
   * `onConnectWorkspace` automatically; `connect_notion` does nothing.
   */
  onConnectCapability?: (cta: CapabilityCta) => void;
}

// Detects OpenUI Lang tags in assistant text. Mirrors the legacy gate from
// ChatWindow — extend when more components land in openui/library.
const OPENUI_TAG = /<Picker\b/;

/**
 * Renders the chronological list of chat bubbles + inline UI directives.
 * Stateless — caller owns the messages array and handler callbacks.
 */
export function ChatStream({
  messages,
  pending = false,
  pendingLabel = 'breathing…',
  onChoice,
  onGoogleSignIn,
  onEmailSignIn,
  onConnectWorkspace,
  onProInterest,
  onWallAuthUser,
  onWallUpgradeToPro,
  onConnectCapability,
}: ChatStreamProps) {
  // Wall-card handlers default to the existing flows. The wall lives inside
  // the assistant transcript so we deliberately reuse the same OAuth /
  // upgrade-interest plumbing already wired to AuthPrompt / UpgradePrompt.
  const wallAuth = onWallAuthUser ?? onGoogleSignIn;
  const wallUpgrade = onWallUpgradeToPro ?? onProInterest;
  // Capability-picker tile dispatch. `connect_workspace` always routes
  // through the existing handler (same flow as the WorkspacePrompt
  // molecule). `connect_notion` requires the caller to supply
  // onConnectCapability — without it, the Notion tile click is a no-op
  // (no broken-flow risk; users can still connect via settings).
  const capabilityDispatch = (cta: CapabilityCta) => {
    if (onConnectCapability) {
      onConnectCapability(cta);
      return;
    }
    if (cta === 'connect_workspace') onConnectWorkspace();
  };
  return (
    <>
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <Bubble key={m.id} from="user" timestamp={m.timestamp}>
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
            timestamp={m.timestamp}
            onChoice={onChoice}
            onGoogleSignIn={onGoogleSignIn}
            onEmailSignIn={onEmailSignIn}
            onConnectWorkspace={onConnectWorkspace}
            onProInterest={onProInterest}
            onWallAuthUser={wallAuth}
            onWallUpgradeToPro={wallUpgrade}
            onConnectCapability={capabilityDispatch}
          />
        );
      })}
      {pending && (
        <div
          data-testid="chat-stream-pending"
          className="flex items-center gap-2 text-sm italic text-muted-foreground"
        >
          <Spinner size="xs" />
          {pendingLabel}
        </div>
      )}
    </>
  );
}

interface AssistantGroupProps {
  msgId: string;
  elements: ChatStreamElement[];
  answered: boolean;
  /** Stamps only the LAST text bubble so a tool-call → text sequence shows
   * a single time label, on the visible reply rather than the badge. */
  timestamp?: number;
  onChoice: (msgId: string, answer: string) => void;
  onGoogleSignIn: () => void;
  onEmailSignIn: (email: string) => void;
  onConnectWorkspace: () => void;
  onProInterest: () => void;
  onWallAuthUser: () => void;
  onWallUpgradeToPro: () => void;
  onConnectCapability: (cta: CapabilityCta) => void;
}

function AssistantGroup({
  msgId,
  elements,
  answered,
  timestamp,
  onChoice,
  onGoogleSignIn,
  onEmailSignIn,
  onConnectWorkspace,
  onProInterest,
  onWallAuthUser,
  onWallUpgradeToPro,
  onConnectCapability,
}: AssistantGroupProps) {
  // Index of the last text element — only that bubble carries the timestamp,
  // otherwise a sequence like [tool-call, tool-call, text] would either
  // double-stamp or stamp the badge.
  const lastTextIndex = (() => {
    for (let i = elements.length - 1; i >= 0; i--) {
      if (elements[i]?.kind === 'text') return i;
    }
    return -1;
  })();

  return (
    <>
      {elements.map((el, i) => {
        const elKey = `${msgId}-${i}-${el.kind}`;
        if (el.kind === 'text') {
          if (OPENUI_TAG.test(el.text)) {
            return (
              <OpenUiOrMarkdown
                key={elKey}
                text={el.text}
                timestamp={i === lastTextIndex ? timestamp : undefined}
              />
            );
          }
          return (
            <Bubble
              key={elKey}
              from="assistant"
              timestamp={i === lastTextIndex ? timestamp : undefined}
            >
              <Markdown>{el.text}</Markdown>
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
        if (el.kind === 'upgrade') {
          return <UpgradePrompt key={elKey} disabled={answered} onInterest={onProInterest} />;
        }
        if (el.kind === 'wall') {
          return (
            <WallPrompt
              key={elKey}
              reason={el.reason}
              cta={el.cta}
              disabled={answered}
              onAuthUser={onWallAuthUser}
              onUpgradeToPro={onWallUpgradeToPro}
            />
          );
        }
        if (el.kind === 'capabilities') {
          return (
            <CapabilityPicker
              key={elKey}
              tiles={el.tiles}
              onConnect={onConnectCapability}
              disabled={answered}
            />
          );
        }
        if (el.kind === 'tool-call') {
          return <ToolCallElement key={elKey} element={el} />;
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

/** Renders a tool-call badge plus any nested bridged sub-agent badges
 * indented under a connector line. Recursive but currently flat in
 * practice — bridged workspace tools never themselves trigger more
 * bridged tools. */
function ToolCallElement({
  element,
}: { element: Extract<ChatStreamElement, { kind: 'tool-call' }> }) {
  const hasChildren = element.children && element.children.length > 0;
  return (
    <div className="flex flex-col gap-1 self-start">
      <ToolCallBadge
        label={element.label}
        done={element.done}
        ok={element.ok}
        args={element.args}
        response={element.response}
      />
      {hasChildren ? (
        <div className="ml-5 flex flex-col gap-1 border-l border-border/60 pl-3">
          {element.children?.map((child, i) =>
            child.kind === 'tool-call' ? (
              <ToolCallElement key={`${child.id}-${i}`} element={child} />
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders assistant text that contains an OpenUI Lang tag. Tries the
 * Renderer first; if the parser can't produce a renderable root (e.g.
 * the prompt teaches stale JSX-like syntax, model emits malformed
 * props, schema mismatch), falls back to plain Markdown so the bubble
 * is never empty.
 *
 * Without this fallback, a parse-failed payload renders as a
 * zero-height div — the "flash then disappear" pattern users see.
 */
function OpenUiOrMarkdown({ text, timestamp }: { text: string; timestamp?: number }) {
  const [parseFailed, setParseFailed] = useState(false);

  if (parseFailed) {
    return (
      <Bubble from="assistant" timestamp={timestamp}>
        <Markdown>{text}</Markdown>
      </Bubble>
    );
  }
  return (
    <div className="self-start max-w-[90%]">
      <Renderer
        response={text}
        library={openUILibrary}
        isStreaming={false}
        onParseResult={(result) => {
          if (result && result.root == null) {
            setParseFailed(true);
          }
        }}
      />
    </div>
  );
}
