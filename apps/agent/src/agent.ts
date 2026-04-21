import { type FunctionTool, LlmAgent } from '@google/adk';
import { type InstructionContext, buildInstruction } from './prompt/buildInstruction.js';

export const AGENT_NAME = 'lifecoach';
export const AGENT_MODEL = 'gemini-2.5-pro';

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
