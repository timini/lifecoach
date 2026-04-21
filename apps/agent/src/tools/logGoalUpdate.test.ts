import { describe, expect, it, vi } from 'vitest';
import type { GoalUpdatesStore } from '../storage/goalUpdates.js';
import { createLogGoalUpdateTool } from './logGoalUpdate.js';

function exec(tool: ReturnType<typeof createLogGoalUpdateTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK tool internals
  return (tool as any).execute(input);
}

describe('log_goal_update tool', () => {
  it('appends to the store with the right arguments', async () => {
    const store: GoalUpdatesStore = {
      append: vi.fn().mockResolvedValue({
        timestamp: '2026-04-21T09:00:00Z',
        goal: 'Running',
        status: 'progress',
        note: 'Did 5k',
      }),
      recent: vi.fn(),
    };
    const tool = createLogGoalUpdateTool({ store, uid: 'u' });
    const res = await exec(tool, { goal: 'Running', status: 'progress', note: 'Did 5k' });
    expect(res).toMatchObject({ status: 'ok' });
    expect(store.append).toHaveBeenCalledWith('u', {
      goal: 'Running',
      status: 'progress',
      note: 'Did 5k',
    });
  });

  it('returns status=error when the store throws', async () => {
    const store: GoalUpdatesStore = {
      append: vi.fn().mockRejectedValue(new Error('nope')),
      recent: vi.fn(),
    };
    const tool = createLogGoalUpdateTool({ store, uid: 'u' });
    const res = await exec(tool, { goal: 'Running', status: 'started' });
    expect(res).toMatchObject({ status: 'error', message: 'nope' });
  });

  it('description encourages silent logging (no announcement)', () => {
    const store: GoalUpdatesStore = { append: vi.fn(), recent: vi.fn() };
    const tool = createLogGoalUpdateTool({ store, uid: 'u' });
    expect(tool.description.toLowerCase()).toContain('never announce');
  });
});
