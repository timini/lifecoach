import { type FunctionTool, LlmAgent } from '@google/adk';
import { type InstructionContext, buildInstruction } from './prompt/buildInstruction.js';

export const AGENT_NAME = 'lifecoach';
// Switched from gemini-2.5-pro → gemini-2.5-flash (2026-04-21): Flash-tier
// models follow the "tool call is your entire response" rule more tightly,
// match the "texting a friend" product brief, and cost less.
//
// Gemini 3 Flash / 3.1 Pro exist on the Gemini API but are NOT yet available
// on Vertex AI in us-central1 (all the 3.x IDs return 404 via the Vertex
// publisher endpoint today). Upgrade path when Vertex ships them:
//   gemini-2.5-flash  →  gemini-3-flash-preview  →  gemini-3-flash (GA).
// If quality regresses vs 2.5-pro on nuance, fall back to 2.5-pro.
export const AGENT_MODEL = 'gemini-2.5-flash';

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
