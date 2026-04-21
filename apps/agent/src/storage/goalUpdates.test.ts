import { describe, expect, it, vi } from 'vitest';
import { createGoalUpdatesStore } from './goalUpdates.js';
import type { BucketLike } from './userProfile.js';

function memoryBucket(): BucketLike & { _files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    _files: files,
    file(path: string) {
      return {
        async download() {
          const data = files.get(path);
          if (data === undefined) {
            const err: NodeJS.ErrnoException = new Error(`not found: ${path}`);
            err.code = '404';
            throw err;
          }
          return [Buffer.from(data, 'utf8')];
        },
        async save(contents: string | Buffer) {
          files.set(path, typeof contents === 'string' ? contents : contents.toString('utf8'));
        },
        async exists() {
          return [files.has(path)];
        },
      };
    },
  };
}

describe('createGoalUpdatesStore', () => {
  it('returns empty array when no file exists yet', async () => {
    const store = createGoalUpdatesStore({ bucket: memoryBucket() });
    expect(await store.recent('u', 20)).toEqual([]);
  });

  it('appends one update and reads it back', async () => {
    const store = createGoalUpdatesStore({
      bucket: memoryBucket(),
      now: () => new Date('2026-04-21T09:00:00Z'),
    });
    const added = await store.append('u', {
      goal: 'Running',
      status: 'progress',
      note: 'Did 5k this morning',
    });
    expect(added.timestamp).toBe('2026-04-21T09:00:00.000Z');

    const recent = await store.recent('u', 20);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.note).toBe('Did 5k this morning');
  });

  it('returns most recent entries first (newest last in file, last N taken)', async () => {
    let n = 1_000_000_000_000;
    const store = createGoalUpdatesStore({
      bucket: memoryBucket(),
      now: () => new Date(n++),
    });
    for (let i = 0; i < 25; i++) {
      await store.append('u', { goal: `G${i}`, status: 'progress' });
    }
    const recent = await store.recent('u', 20);
    expect(recent).toHaveLength(20);
    // The 20 most recent must be G5..G24 in order of occurrence.
    expect(recent[0]?.goal).toBe('G5');
    expect(recent[19]?.goal).toBe('G24');
  });

  it('tolerates a corrupt file by starting fresh', async () => {
    const bucket = memoryBucket();
    bucket._files.set('users/u/goal_updates.json', 'not json');
    const store = createGoalUpdatesStore({ bucket });
    const added = await store.append('u', { goal: 'X', status: 'started' });
    expect(added.goal).toBe('X');
    const recent = await store.recent('u', 20);
    expect(recent).toEqual([added]);
  });

  it('writes JSON with content-type application/json', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const bucket: BucketLike = {
      file: () => ({
        async download() {
          const err: NodeJS.ErrnoException = new Error('nope');
          err.code = '404';
          throw err;
        },
        save,
        async exists() {
          return [false];
        },
      }),
    };
    const store = createGoalUpdatesStore({ bucket });
    await store.append('u', { goal: 'Running', status: 'started' });
    const opts = save.mock.calls[0]?.[1];
    expect(opts).toMatchObject({ contentType: 'application/json' });
  });
});
