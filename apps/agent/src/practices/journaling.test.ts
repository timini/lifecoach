import { describe, expect, it, vi } from 'vitest';
import type { UserProfileStore } from '../storage/userProfile.js';
import { journaling } from './journaling.js';
import type { PracticeCtx } from './types.js';

const CTX = {
  now: new Date('2026-04-28T11:00:00Z'),
  timezone: 'Europe/London',
  userState: 'workspace_connected',
  location: null,
  weather: null,
  practiceState: {},
} as unknown as PracticeCtx;

describe('journaling.directive', () => {
  it('always emits when on (no time-of-day gate)', () => {
    const out = journaling.directive?.(CTX);
    expect(out).not.toBeNull();
    expect(out).toMatch(/JOURNALING/);
    expect(out).toMatch(/journal_entry/);
  });
});

describe('journal_entry tool', () => {
  function fakeStore(initial: unknown = {}): UserProfileStore & {
    updates: Array<{ path: string; value: unknown }>;
  } {
    const updates: Array<{ path: string; value: unknown }> = [];
    return {
      read: vi.fn().mockResolvedValue(initial),
      write: vi.fn().mockResolvedValue(undefined),
      updatePath: vi.fn(async (_uid: string, path: string, value: unknown) => {
        updates.push({ path, value });
        return {};
      }),
      updates,
    } as UserProfileStore & { updates: Array<{ path: string; value: unknown }> };
  }

  async function exec(
    tool: ReturnType<NonNullable<typeof journaling.tools>>[number],
    input: unknown,
  ): Promise<unknown> {
    // biome-ignore lint/suspicious/noExplicitAny: ADK FunctionTool internals
    const fn = (tool as any).func ?? (tool as any).execute ?? (tool as any).executor;
    return fn(input);
  }

  it('appends a new entry with text + mood', async () => {
    const store = fakeStore();
    const tools = journaling.tools?.({ profileStore: store }, 'u1') ?? [];
    const result = await exec(tools[0]!, { text: 'a long day, glad it is done', mood: 'tired' });
    expect(result).toMatchObject({ status: 'ok', count: 1 });
    expect(store.updates[0]?.path).toBe('practices.journaling.entries');
    const entries = store.updates[0]?.value as Array<Record<string, string>>;
    expect(entries[0]?.text).toBe('a long day, glad it is done');
    expect(entries[0]?.mood).toBe('tired');
    expect(entries[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('omits mood key when caller passes none / null', async () => {
    const store = fakeStore();
    const tools = journaling.tools?.({ profileStore: store }, 'u1') ?? [];
    await exec(tools[0]!, { text: 'just a note' });
    const entries = store.updates[0]?.value as Array<Record<string, unknown>>;
    expect('mood' in (entries[0] ?? {})).toBe(false);
  });

  it('caps the inline list at 50 entries (oldest dropped)', async () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({
      ts: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
      text: `entry-${i}`,
    }));
    const store = fakeStore({ practices: { journaling: { entries: existing } } });
    const tools = journaling.tools?.({ profileStore: store }, 'u1') ?? [];
    const result = await exec(tools[0]!, { text: 'newest' });
    expect(result).toMatchObject({ status: 'ok', count: 50 });
    const entries = store.updates[0]?.value as Array<{ text: string }>;
    expect(entries.length).toBe(50);
    expect(entries[0]?.text).toBe('entry-1'); // oldest dropped
    expect(entries[49]?.text).toBe('newest');
  });
});
