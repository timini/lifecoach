import { GoogleGenAI } from '@google/genai';

/**
 * LLM-as-judge for the chat-quality e2e. Sends a multi-turn transcript
 * to Gemini through Vertex (ADC for auth — WIF in CI, `gcloud auth
 * application-default login` locally) and asks for a per-turn pass /
 * fail verdict.
 *
 * The judge is instructed to flag the regression classes the existing
 * specs miss: hardcoded recovery templates ("Hmm, I missed that…"),
 * empty bubbles, off-topic responses, and hallucinated tool actions.
 */

export interface JudgeTurn {
  user: string;
  assistant: string;
}

export interface TurnVerdict {
  turn: number;
  pass: boolean;
  reason: string;
}

export interface JudgeVerdict {
  pass: boolean;
  perTurn: TurnVerdict[];
}

const PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCP_PROJECT ??
  process.env.GOOGLE_PROJECT ??
  'lifecoach-dev-zvb6d';

// Match the agent's model. The judge doesn't need a smarter tier — the
// failure modes (recovery template, empty, off-topic) are obvious.
const JUDGE_MODEL = process.env.E2E_JUDGE_MODEL ?? 'gemini-3-flash-preview';
const JUDGE_LOCATION = process.env.E2E_JUDGE_LOCATION ?? 'global';

const JUDGE_PROMPT = `You are evaluating a multi-turn conversation between a user and a personal life-coach AI assistant.

For EACH turn, score whether the assistant's reply is SUBSTANTIVE and ON-TOPIC.

A turn FAILS if the assistant:
- Returns a hardcoded recovery / non-answer template such as:
  • "Hmm, I missed that — could you say it again?"
  • "Done. What next?"
  • "All set — anything jump out, or want me to dig in?"
  • Any short generic response that does not engage with what the user said.
- Returns an empty bubble or the literal token "<NO ASSISTANT REPLY>".
- Repeats itself essentially verbatim across turns.
- Hallucinates having performed an action that was not requested.
- Is incoherent or off-topic relative to the user's specific message.

A turn PASSES if the assistant engages with the user's specific message in a relevant, helpful way — even if brief, and even if it asks a clarifying question (so long as the question is grounded in what the user said).

Conversation:
{TRANSCRIPT}

Respond with ONLY a single JSON object of this exact shape (no prose, no markdown fencing):
{"perTurn":[{"turn":1,"pass":true|false,"reason":"<one short sentence>"}]}`;

function formatTranscript(turns: JudgeTurn[]): string {
  return turns
    .map((t, i) => `[Turn ${i + 1}]\nUser: ${t.user}\nAssistant: ${t.assistant}`)
    .join('\n\n');
}

function stripJsonFencing(text: string): string {
  // Be tolerant of accidental ```json ... ``` fencing even though the
  // prompt asks for raw JSON.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(text.trim());
  return fence ? fence[1] : text;
}

export async function judgeTranscript(turns: JudgeTurn[]): Promise<JudgeVerdict> {
  if (turns.length === 0) {
    return { pass: false, perTurn: [] };
  }
  const ai = new GoogleGenAI({
    vertexai: true,
    project: PROJECT,
    location: JUDGE_LOCATION,
  });
  const prompt = JUDGE_PROMPT.replace('{TRANSCRIPT}', formatTranscript(turns));
  const response = await ai.models.generateContent({
    model: JUDGE_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });
  const raw = response.text ?? '';
  let parsed: { perTurn?: TurnVerdict[] };
  try {
    parsed = JSON.parse(stripJsonFencing(raw));
  } catch (_err) {
    throw new Error(`Judge returned non-JSON: ${raw.slice(0, 800)}`);
  }
  if (!Array.isArray(parsed.perTurn)) {
    throw new Error(`Judge response missing perTurn[]: ${raw.slice(0, 800)}`);
  }
  // Coerce in case the judge omitted a turn.
  const byTurn = new Map<number, TurnVerdict>();
  for (const v of parsed.perTurn) {
    if (typeof v.turn === 'number') byTurn.set(v.turn, v);
  }
  const filled: TurnVerdict[] = turns.map((_, i) => {
    const got = byTurn.get(i + 1);
    if (got) return got;
    return { turn: i + 1, pass: false, reason: 'judge omitted this turn from response' };
  });
  const allPass = filled.every((t) => t.pass);
  return { pass: allPass, perTurn: filled };
}
