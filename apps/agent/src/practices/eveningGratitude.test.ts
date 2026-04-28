import { describe, expect, it, vi } from 'vitest';
import type { InstructionContext } from '../prompt/buildInstruction.js';
import type { UserProfileStore } from '../storage/userProfile.js';
import { eveningGratitude } from './eveningGratitude.js';
import type { PracticeCtx } from './types.js';

const BASE_CTX: InstructionContext = {
  now: new Date('2026-04-28T19:00:00Z'), // 8pm London (BST = UTC+1)
  timezone: 'Europe/London',
  userState: 'workspace_connected',
  location: null,
  weather: null,
};

function ctx(overrides: Partial<PracticeCtx> = {}): PracticeCtx {
  return {
    ...BASE_CTX,
    practiceState: {},
    ...overrides,
  } as PracticeCtx;
}

describe('eveningGratitude.directive', () => {
  it('emits when in the evening window and not yet logged today', () => {
    const out = eveningGratitude.directive?.(ctx());
    expect(out).not.toBeNull();
    expect(out).toMatch(/EVENING_GRATITUDE/);
    expect(out).toMatch(/log_gratitude/);
  });

  it('skips before 18:00 local', () => {
    const morning = ctx({ now: new Date('2026-04-28T08:00:00Z') }); // 9am London
    expect(eveningGratitude.directive?.(morning)).toBeNull();
  });

  it('skips after 23:59 local', () => {
    // 02:00 London (next day)
    const lateNight = ctx({ now: new Date('2026-04-29T01:00:00Z') });
    expect(eveningGratitude.directive?.(lateNight)).toBeNull();
  });

  it('skips when last_logged matches today (London local date)', () => {
    const evening = ctx({
      now: new Date('2026-04-28T19:00:00Z'),
      practiceState: { last_logged: '2026-04-28' },
    });
    expect(eveningGratitude.directive?.(evening)).toBeNull();
  });

  it('emits when last_logged is from a previous day', () => {
    const evening = ctx({
      now: new Date('2026-04-28T19:00:00Z'),
      practiceState: { last_logged: '2026-04-27' },
    });
    expect(eveningGratitude.directive?.(evening)).not.toBeNull();
  });
});

describe('log_gratitude tool', () => {
  function fakeStore(): UserProfileStore & {
    updates: Array<{ path: string; value: unknown }>;
  } {
    const updates: Array<{ path: string; value: unknown }> = [];
    return {
      read: vi.fn().mockResolvedValue({}),
      write: vi.fn().mockResolvedValue(undefined),
      updatePath: vi.fn(async (_uid: string, path: string, value: unknown) => {
        updates.push({ path, value });
        return {};
      }),
      updates,
    } as UserProfileStore & { updates: Array<{ path: string; value: unknown }> };
  }

  async function execTool(
    tool: ReturnType<NonNullable<typeof eveningGratitude.tools>>[number],
    input: unknown,
  ): Promise<unknown> {
    // ADK's FunctionTool stores the executor on `func` (older versions) or
    // exposes runAsync/run; for tests we reach into the private execute
    // captured at construction. Using `(tool as any).execute` works because
    // the FunctionTool class stores it directly.
    // biome-ignore lint/suspicious/noExplicitAny: test reaches into ADK internals
    const fn = (tool as any).func ?? (tool as any).execute ?? (tool as any).executor;
    if (typeof fn !== 'function') throw new Error('cannot find tool executor on FunctionTool');
    return fn(input);
  }

  it('appends an entry, sets last_logged, and returns ok', async () => {
    const store = fakeStore();
    const tools = eveningGratitude.tools?.({ profileStore: store }, 'u1') ?? [];
    expect(tools).toHaveLength(1);
    const result = await execTool(tools[0]!, { text: 'sunshine' });
    expect(result).toMatchObject({ status: 'ok', count: 1 });
    expect(store.updates.map((u) => u.path)).toEqual([
      'practices.evening_gratitude.entries',
      'practices.evening_gratitude.last_logged',
    ]);
    const entries = store.updates[0]?.value as Array<{ text: string; date: string; ts: string }>;
    expect(entries[0]?.text).toBe('sunshine');
    expect(entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entries[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends to an existing entries array (does not clobber)', async () => {
    const store = fakeStore();
    (store.read as ReturnType<typeof vi.fn>).mockResolvedValue({
      practices: {
        evening_gratitude: {
          entries: [{ date: '2026-04-27', text: 'old', ts: '2026-04-27T19:00:00Z' }],
        },
      },
    });
    const tools = eveningGratitude.tools?.({ profileStore: store }, 'u1') ?? [];
    const result = await execTool(tools[0]!, { text: 'new' });
    expect(result).toMatchObject({ status: 'ok', count: 2 });
    const entries = store.updates[0]?.value as Array<{ text: string }>;
    expect(entries.map((e) => e.text)).toEqual(['old', 'new']);
  });

  it('returns error status when store throws', async () => {
    const store = fakeStore();
    (store.updatePath as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const tools = eveningGratitude.tools?.({ profileStore: store }, 'u1') ?? [];
    const result = (await execTool(tools[0]!, { text: 'oops' })) as { status: string };
    expect(result.status).toBe('error');
  });
});
