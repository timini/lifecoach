import { emptyUserProfile } from '@lifecoach/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { UserProfileStore } from '../storage/userProfile.js';
import { createUpdateUserProfileTool } from './updateUserProfile.js';

function fakeStore(): UserProfileStore & { _calls: Array<{ path: string; value: unknown }> } {
  const calls: Array<{ path: string; value: unknown }> = [];
  return {
    _calls: calls,
    async read() {
      return emptyUserProfile();
    },
    async write() {
      /* noop */
    },
    async updatePath(_uid, path, value) {
      calls.push({ path, value });
      const after = emptyUserProfile();
      // crude dotted-path set for the assertions
      if (path === 'name' && typeof value === 'string') after.name = value;
      if (path === 'family.children' && typeof value === 'string') after.family.children = value;
      if (path === 'age' && typeof value === 'number') after.age = value;
      return after;
    },
  };
}

function exec(tool: ReturnType<typeof createUpdateUserProfileTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK tool internals
  return (tool as any).execute(input);
}

describe('update_user_profile tool', () => {
  it('is named and described for the LLM to discover', () => {
    const tool = createUpdateUserProfileTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe('update_user_profile');
    expect(tool.description.toLowerCase()).toContain('dotted path');
  });

  it('writes a string value to the store', async () => {
    const store = fakeStore();
    const tool = createUpdateUserProfileTool({ store, uid: 'u' });
    const res = await exec(tool, { path: 'name', value: 'Tim' });
    expect(res).toMatchObject({ status: 'ok', updated_path: 'name', new_value: 'Tim' });
    expect(store._calls).toEqual([{ path: 'name', value: 'Tim' }]);
  });

  it('parses numeric strings for age', async () => {
    const store = fakeStore();
    const tool = createUpdateUserProfileTool({ store, uid: 'u' });
    const res = await exec(tool, { path: 'age', value: '37' });
    expect(res).toMatchObject({ status: 'ok', new_value: 37 });
    expect(store._calls).toEqual([{ path: 'age', value: 37 }]);
  });

  it('rejects non-numeric age', async () => {
    const tool = createUpdateUserProfileTool({ store: fakeStore(), uid: 'u' });
    const res = await exec(tool, { path: 'age', value: 'thirty-seven' });
    expect(res).toMatchObject({ status: 'error' });
  });

  it('parses JSON arrays for goals.*_term', async () => {
    const store = fakeStore();
    const tool = createUpdateUserProfileTool({ store, uid: 'u' });
    const res = await exec(tool, {
      path: 'goals.short_term',
      value: '["Running","Garden"]',
    });
    expect(res).toMatchObject({ status: 'ok' });
    expect(store._calls).toEqual([{ path: 'goals.short_term', value: ['Running', 'Garden'] }]);
  });

  it('rejects non-array value for goals lists', async () => {
    const tool = createUpdateUserProfileTool({ store: fakeStore(), uid: 'u' });
    const res = await exec(tool, { path: 'goals.short_term', value: 'Running' });
    expect(res).toMatchObject({ status: 'error' });
  });

  it('passes null through unchanged', async () => {
    const store = fakeStore();
    const tool = createUpdateUserProfileTool({ store, uid: 'u' });
    await exec(tool, { path: 'name', value: null });
    expect(store._calls).toEqual([{ path: 'name', value: null }]);
  });

  it('returns status=error when the store throws', async () => {
    const store: UserProfileStore = {
      read: vi.fn(),
      write: vi.fn(),
      updatePath: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const tool = createUpdateUserProfileTool({ store, uid: 'u' });
    const res = await exec(tool, { path: 'name', value: 'Tim' });
    expect(res).toMatchObject({ status: 'error', message: 'boom' });
  });
});
