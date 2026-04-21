/**
 * Concatenates all `text` parts from `content.parts` across every SSE event
 * whose `author` is the Lifecoach agent. This is a best-effort read for a
 * non-streaming UI — Phase 1 reads the full body then parses; later phases
 * will read the stream incrementally for token-by-token rendering.
 */
export function parseSseAssistantText(raw: string): string {
  const parts: string[] = [];
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
    if (parsed.author !== 'lifecoach') continue;

    for (const part of parsed.content?.parts ?? []) {
      if (typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('');
}

interface AgentEvent {
  author?: string;
  content?: { parts?: Array<{ text?: string }> };
}

function isAgentEvent(v: unknown): v is AgentEvent {
  return typeof v === 'object' && v !== null;
}
