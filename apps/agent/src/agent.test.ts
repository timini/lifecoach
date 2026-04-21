import { describe, expect, it } from 'vitest';
import { AGENT_MODEL, AGENT_NAME, createRootAgent } from './agent.js';
import type { InstructionContext } from './prompt/buildInstruction.js';

const CTX: InstructionContext = {
  now: new Date('2026-04-21T09:00:00Z'),
  timezone: 'Australia/Melbourne',
  userState: 'anonymous',
  location: null,
  weather: null,
};

describe('createRootAgent', () => {
  it('returns an agent with the Lifecoach name and configured model', () => {
    const agent = createRootAgent(CTX);
    expect(agent.name).toBe(AGENT_NAME);
    expect(agent.model).toBe(AGENT_MODEL);
  });

  it('bakes the dynamic instruction into the agent', () => {
    const agent = createRootAgent(CTX);
    const s = typeof agent.instruction === 'string' ? agent.instruction : '';
    expect(s).toMatch(/Lifecoach/);
    expect(s).toMatch(/2026-04-21/); // today
    expect(s).toMatch(/anonymous/); // state
  });

  it('pins gemini-3-flash-preview (needs GOOGLE_CLOUD_LOCATION=global)', () => {
    // Explicit pin so any model change is deliberate and reviewed.
    // Gemini 3.* is only reachable via the Vertex `global` publisher
    // endpoint — all regional endpoints return 404.
    expect(AGENT_MODEL).toBe('gemini-3-flash-preview');
  });
});
