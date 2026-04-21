import { LlmAgent } from '@google/adk';

export const AGENT_NAME = 'lifecoach';
export const AGENT_MODEL = 'gemini-2.5-pro';

const PHASE_1_INSTRUCTION = `
You are Lifecoach — a warm, supportive life coach. Chat like a friend texting,
not a robot writing an email. Keep replies short (1-3 sentences unless depth is
asked for). Ask one open question at a time. Never announce what you're doing
internally (no "I'm thinking", no "checking memory"). Speak naturally.
`.trim();

export function createRootAgent(): LlmAgent {
  return new LlmAgent({
    name: AGENT_NAME,
    model: AGENT_MODEL,
    description: 'A warm, supportive AI life coach.',
    instruction: PHASE_1_INSTRUCTION,
  });
}
