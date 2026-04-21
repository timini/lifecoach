import { type FunctionTool, LlmAgent } from '@google/adk';
import { type InstructionContext, buildInstruction } from './prompt/buildInstruction.js';

export const AGENT_NAME = 'lifecoach';
// Gemini 3 Flash on Vertex AI (2026-04-21). Reachable via the `global`
// publisher location only — all regional endpoints (us-central1, us-east5,
// europe-west1, etc.) return 404 today. Hence the agent's Cloud Run env
// sets GOOGLE_CLOUD_LOCATION=global so @google/genai builds the right URL.
//
// Previous pins: gemini-2.5-flash (used as an interim when Gemini 3 looked
// unreachable), gemini-2.5-pro (initial — was too wordy with the choice-tool
// rule). Fallback if Flash regresses on nuance: gemini-3.1-pro-preview
// (also reachable on location=global).
export const AGENT_MODEL = 'gemini-3-flash-preview';

/**
 * Create a root agent with instructions baked in for a specific turn's
 * context, plus any tools that should be available this turn.
 */
export function createRootAgent(ctx: InstructionContext, tools: FunctionTool[] = []): LlmAgent {
  return new LlmAgent({
    name: AGENT_NAME,
    model: AGENT_MODEL,
    description: 'A warm, supportive AI life coach.',
    instruction: buildInstruction(ctx),
    tools,
  });
}
