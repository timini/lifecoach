/**
 * Production summarizer for sessionSummary.ts. Wraps a single
 * `@google/genai` call against gemini-flash-lite-latest — the cheap, fast
 * model issue #10 specifies for one-paragraph daily-summary work.
 *
 * Kept in its own file so the data-layer (sessionSummary.ts) stays LLM-
 * agnostic and unit-testable with a stub. The production wiring in
 * server.ts plugs this factory into createSessionSummaryClient.
 */

import { GoogleGenAI } from '@google/genai';
import type { Summarizer } from './sessionSummary.js';

const MODEL = 'gemini-flash-lite-latest';

const SYSTEM_PROMPT = `You write one-paragraph summaries of a single day's coaching chat between a User and Coach. The summary will be injected into tomorrow's system prompt so the Coach has continuity without re-reading the transcript.

Rules:
- One paragraph, ~80 words. No headings, no bullets.
- Capture: what they talked about, what the user committed to or felt, anything left unresolved.
- Past tense, third person ("the user", "they"). No "I" or "we".
- No quoting verbatim. Compress.
- No greetings, sign-offs, or meta-commentary about being an AI.

Output ONLY the summary paragraph.`;

export function createGeminiFlashLiteSummarizer(deps: {
  /** GoogleGenAI client (Vertex-mode in production via env). Override in tests. */
  client?: GoogleGenAI;
  /** Override the model id; default is gemini-flash-lite-latest. */
  model?: string;
}): Summarizer {
  const client = deps.client ?? new GoogleGenAI({});
  const model = deps.model ?? MODEL;

  return async function summarize(transcript: string): Promise<string | null> {
    if (!transcript.trim()) return null;
    try {
      const response = await client.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: SYSTEM_PROMPT }, { text: '\n\nTRANSCRIPT:\n' }, { text: transcript }],
          },
        ],
        config: {
          temperature: 0.3,
          maxOutputTokens: 256,
        },
      });
      const text = (response.candidates?.[0]?.content?.parts ?? [])
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('')
        .trim();
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  };
}
