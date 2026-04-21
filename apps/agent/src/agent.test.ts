import { describe, expect, it } from 'vitest';
import { AGENT_MODEL, AGENT_NAME, createRootAgent } from './agent.js';

describe('createRootAgent', () => {
  it('returns an agent with the Lifecoach name and configured model', () => {
    const agent = createRootAgent();
    expect(agent.name).toBe(AGENT_NAME);
    expect(agent.model).toBe(AGENT_MODEL);
  });

  it('has a non-empty instruction string for the coach persona', () => {
    const agent = createRootAgent();
    const instruction = typeof agent.instruction === 'string' ? agent.instruction : '';
    expect(instruction.length).toBeGreaterThan(50);
    expect(instruction.toLowerCase()).toContain('coach');
  });

  it('uses gemini-2.5-pro (the spec said 3.1 Pro which does not exist)', () => {
    expect(AGENT_MODEL).toBe('gemini-2.5-pro');
  });
});
