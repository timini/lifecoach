import { describe, expect, it, vi } from 'vitest';
import type { MemoryClient } from '../context/memory.js';
import { createMemorySaveTool } from './memorySave.js';

function exec(tool: ReturnType<typeof createMemorySaveTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK tool internals
  return (tool as any).execute(input);
}

describe('memory_save tool', () => {
  it('calls client.save with uid and text, returns ok', async () => {
    const client: MemoryClient = {
      search: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const tool = createMemorySaveTool({ client, uid: 'u' });
    const res = await exec(tool, {
      text: 'User prefers mornings for deep-work blocks.',
    });
    expect(res).toEqual({ status: 'ok' });
    expect(client.save).toHaveBeenCalledWith('u', 'User prefers mornings for deep-work blocks.');
  });

  it("description tells the model never to announce it's saving", () => {
    const client: MemoryClient = { search: vi.fn(), save: vi.fn() };
    const tool = createMemorySaveTool({ client, uid: 'u' });
    expect(tool.description.toLowerCase()).toContain('never announce');
  });

  it('returns error if client.save rejects', async () => {
    const client: MemoryClient = {
      search: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const tool = createMemorySaveTool({ client, uid: 'u' });
    const res = await exec(tool, { text: 'User likes pizza.' });
    expect(res).toMatchObject({ status: 'error', message: 'boom' });
  });
});
