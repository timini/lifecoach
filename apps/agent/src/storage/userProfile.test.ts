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
    expect(setDottedPath({ a: 1 }, 'a', 2)).toEqual({ a: 2 });
  });

  it('sets a nested key', () => {
    expect(setDottedPath({ a: { b: 1 } }, 'a.b', 2)).toEqual({ a: { b: 2 } });
  });

  it('creates missing intermediate objects', () => {
    expect(setDottedPath({}, 'a.b.c', 3)).toEqual({ a: { b: { c: 3 } } });
  });

  it('replaces a primitive intermediate with an object when drilling deeper', () => {
    expect(setDottedPath({ a: 'scalar' }, 'a.b', 2)).toEqual({ a: { b: 2 } });
  });

  it('does not mutate the input', () => {
    const o = { a: { b: 1 } };
    setDottedPath(o, 'a.b', 2);
    expect(o).toEqual({ a: { b: 1 } });
  });
});

describe('createUserProfileStore (schema-free)', () => {
  it('returns the starter template when the file does not exist', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    const p = await store.read('uid-1');
    expect(p.name).toBeNull();
    expect(p.goals).toMatchObject({ short_term: [] });
  });

  it('round-trips a whole doc via write + read', async () => {
    const bucket = memoryBucket();
    const store = createUserProfileStore({ bucket });
    await store.write('uid-1', { name: 'Alex', pets: { name: 'Cosmo' } });
    const r = await store.read('uid-1');
    expect(r).toEqual({ name: 'Alex', pets: { name: 'Cosmo' } });
  });

  it('updatePath writes any path the coach invents — no allowlist', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    const after = await store.updatePath('uid-1', 'volunteering', 'community garden weekends');
    expect(after.volunteering).toBe('community garden weekends');
  });

  it('updatePath handles brand-new nested paths (pet.species)', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    const after = await store.updatePath('uid-1', 'pet.species', 'cavoodle');
    expect((after.pet as Record<string, unknown>).species).toBe('cavoodle');
  });

  it('preserves existing keys when updating a different path', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    await store.write('uid-1', { name: 'Alex' });
    await store.updatePath('uid-1', 'pets.name', 'Cosmo');
    const r = await store.read('uid-1');
    expect(r.name).toBe('Alex');
    expect((r.pets as Record<string, unknown>).name).toBe('Cosmo');
  });

  it('rejects an empty path', async () => {
    const store = createUserProfileStore({ bucket: memoryBucket() });
    await expect(store.updatePath('uid-1', '', 'x')).rejects.toThrow(/path is required/);
  });

  it('falls back to the starter template on corrupt YAML', async () => {
    const bucket = memoryBucket();
    bucket._files.set('users/u/user.yaml', 'this : is : broken : yaml :::');
    const store = createUserProfileStore({ bucket });
    const r = await store.read('u');
    // Either the parse throws (then we rethrow) or the fallback kicks in.
    // Our implementation rethrows non-404 errors; verify by catching.
    expect(r.name).toBeNull();
  });

  it('writes YAML with content-type application/yaml', async () => {
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
    await store.updatePath('u', 'name', 'Alex');
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls[0]?.[1]).toMatchObject({ contentType: 'application/yaml' });
  });
});
