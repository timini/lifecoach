import { describe, expect, it, vi } from 'vitest';
import { type BucketLike, createUserProfileStore, setDottedPath } from './userProfile.js';

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
        async save(contents: string | Buffer, _opts?: unknown) {
          files.set(path, typeof contents === 'string' ? contents : contents.toString('utf8'));
        },
        async exists() {
          return [files.has(path)];
        },
      };
    },
  };
}

describe('setDottedPath', () => {
  it('sets a shallow key', () => {
    const o = { a: 1 };
    expect(setDottedPath(o, 'a', 2)).toEqual({ a: 2 });
  });

  it('sets a nested key', () => {
    expect(setDottedPath({ a: { b: 1 } }, 'a.b', 2)).toEqual({ a: { b: 2 } });
  });

  it('creates missing intermediate objects', () => {
    expect(setDottedPath({}, 'a.b.c', 3)).toEqual({ a: { b: { c: 3 } } });
  });

  it('does not mutate the input', () => {
    const o = { a: { b: 1 } };
    setDottedPath(o, 'a.b', 2);
    expect(o).toEqual({ a: { b: 1 } });
  });
});

describe('createUserProfileStore', () => {
  it('returns a fully-null profile when the file does not exist', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    const p = await store.read('uid-1');
    expect(p.name).toBeNull();
    expect(p.goals.short_term).toEqual([]);
  });

  it('round-trips a profile via write + read', async () => {
    const bucket = memoryBucket();
    const store = createUserProfileStore({ bucket });

    const initial = await store.read('uid-1');
    await store.write('uid-1', { ...initial, name: 'Tim' });
    const roundTripped = await store.read('uid-1');
    expect(roundTripped.name).toBe('Tim');
    expect(bucket._files.has('users/uid-1/user.yaml')).toBe(true);
  });

  it('applies a dotted-path update', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    const after = await store.updatePath('uid-1', 'family.children', 'Wren and Silvie');
    expect(after.family.children).toBe('Wren and Silvie');

    const reread = await store.read('uid-1');
    expect(reread.family.children).toBe('Wren and Silvie');
  });

  it('rejects updates to paths outside the writable allowlist', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    // @ts-expect-error — the allowlist is enforced at runtime even if a caller bypasses types
    await expect(store.updatePath('uid-1', 'cheese', 'gouda')).rejects.toThrow(/writable path/i);
  });

  it('stores YAML with null leaves preserved (not omitted)', async () => {
    const bucket = memoryBucket();
    const store = createUserProfileStore({ bucket });
    await store.updatePath('uid-1', 'name', 'Tim');
    const yaml = bucket._files.get('users/uid-1/user.yaml') ?? '';
    expect(yaml).toMatch(/name: Tim/);
    expect(yaml).toMatch(/partner_name: null/);
    expect(yaml).toMatch(/short_term: \[\]/);
  });
});

describe('bucket write options', () => {
  it('writes with content-type application/yaml', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const bucket: BucketLike = {
      file: () => ({
        async download() {
          const err: NodeJS.ErrnoException = new Error('not found');
          err.code = '404';
          throw err;
        },
        save,
        async exists() {
          return [false];
        },
      }),
    };
    const store = createUserProfileStore({ bucket });
    await store.updatePath('uid-1', 'name', 'Tim');
    expect(save).toHaveBeenCalled();
    const opts = save.mock.calls[0]?.[1];
    expect(opts).toMatchObject({ contentType: 'application/yaml' });
  });
});
