/**
 * Parses an SSE response body into an ordered list of assistant "elements":
 *   - { kind: 'text', text } — concatenated text parts from lifecoach events
 *   - { kind: 'choice', single, question, options } — surfaced by the
 *     ask_single/multiple_choice_question tool's response
 *
 * The previous shape (parseSseAssistantText → string) is still exported as
 * a thin wrapper so older callers / tests don't break.
 */

export type AssistantElement =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; single: boolean; question: string; options: string[] };

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

    // Collect text from lifecoach events.
    if (parsed.author === 'lifecoach') {
      for (const part of parsed.content?.parts ?? []) {
        if (typeof part.text === 'string') pendingText += part.text;
      }
    }

    // Detect choice-question tool responses anywhere in the event.
    for (const part of parsed.content?.parts ?? []) {
      const fr = part.functionResponse;
      if (!fr) continue;
      const resp = fr.response as
        | { status?: string; kind?: string; question?: string; options?: unknown }
        | undefined;
      if (
        resp?.status === 'shown' &&
        (fr.name === 'ask_single_choice_question' || fr.name === 'ask_multiple_choice_question') &&
        typeof resp.question === 'string' &&
        Array.isArray(resp.options) &&
        resp.options.every((o) => typeof o === 'string')
      ) {
        // Flush any accumulated text before the choice so they render in order.
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

interface AgentEvent {
  author?: string;
  content?: { parts?: Array<AgentPart> };
}
interface AgentPart {
  text?: string;
  functionResponse?: {
    name?: string;
    response?: unknown;
  };
}

function isAgentEvent(v: unknown): v is AgentEvent {
  return typeof v === 'object' && v !== null;
}
