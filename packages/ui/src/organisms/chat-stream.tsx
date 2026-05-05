'use client';

import { Spinner } from '../atoms/spinner';
import { AuthPrompt } from '../molecules/auth-prompt';
import { Bubble } from '../molecules/bubble';
import { ChoicePrompt } from '../molecules/choice-prompt';
import { ToolCallBadge } from '../molecules/tool-call-badge';
import { UpgradePrompt } from '../molecules/upgrade-prompt';
import { WorkspacePrompt } from '../molecules/workspace-prompt';
import { Renderer, library as openUILibrary } from '../openui/library';
import { Markdown } from './markdown';

export type ChatStreamElement =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; single: boolean; question: string; options: string[] }
  | { kind: 'auth'; mode: 'google' | 'email'; email?: string }
  | { kind: 'workspace' }
  | { kind: 'upgrade' }
  | { kind: 'tool-call'; id: string; name: string; label: string; done: boolean; ok?: boolean };

export interface ChatStreamUserMessage {
  id: string;
  role: 'user';
  text: string;
}
export interface ChatStreamAssistantMessage {
  id: string;
  role: 'assistant';
  elements: ChatStreamElement[];
  answered?: boolean;
}
export type ChatStreamMessage = ChatStreamUserMessage | ChatStreamAssistantMessage;

export interface ChatStreamProps {
  messages: ChatStreamMessage[];
  /**
   * Show a "thinking…" / "retrying…" indicator below the last message. Caller
   * decides when (typically: busy && last assistant bubble has no content).
   */
  pending?: boolean;
  /** Optional copy override for the pending row (e.g. "retrying… (1)"). */
  pendingLabel?: string;
  onChoice: (msgId: string, answer: string) => void;
  onGoogleSignIn: () => void;
  onEmailSignIn: (email: string) => void;
  onConnectWorkspace: () => void;
  onProInterest: () => void;
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
}: ChatStreamProps) {
  return (
    <>
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
            onChoice={onChoice}
            onGoogleSignIn={onGoogleSignIn}
            onEmailSignIn={onEmailSignIn}
            onConnectWorkspace={onConnectWorkspace}
            onProInterest={onProInterest}
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
  onChoice: (msgId: string, answer: string) => void;
  onGoogleSignIn: () => void;
  onEmailSignIn: (email: string) => void;
  onConnectWorkspace: () => void;
  onProInterest: () => void;
}

function AssistantGroup({
  msgId,
  elements,
  answered,
  onChoice,
  onGoogleSignIn,
  onEmailSignIn,
  onConnectWorkspace,
  onProInterest,
}: AssistantGroupProps) {
  return (
    <>
      {elements.map((el, i) => {
        const elKey = `${msgId}-${i}-${el.kind}`;
        if (el.kind === 'text') {
          if (OPENUI_TAG.test(el.text)) {
            return (
              <div key={elKey} className="self-start max-w-[90%]">
                <Renderer response={el.text} library={openUILibrary} isStreaming={false} />
              </div>
            );
          }
          return (
            <Bubble key={elKey} from="assistant">
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
        if (el.kind === 'tool-call') {
          return <ToolCallBadge key={elKey} label={el.label} done={el.done} ok={el.ok} />;
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
