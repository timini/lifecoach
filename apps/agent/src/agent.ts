import { LlmAgent } from '@google/adk';
import { type InstructionContext, buildInstruction } from './prompt/buildInstruction.js';

export const AGENT_NAME = 'lifecoach';
export const AGENT_MODEL = 'gemini-2.5-pro';

/**
 * Create a root agent with instructions baked in for a specific turn's
 * context. We construct a fresh LlmAgent per turn because the instruction
 * block is dynamic (time, location, weather, user state all change).
 */
export function createRootAgent(ctx: InstructionContext): LlmAgent {
  return new LlmAgent({
    name: AGENT_NAME,
    model: AGENT_MODEL,
    description: 'A warm, supportive AI life coach.',
    instruction: buildInstruction(ctx),
  });
}
