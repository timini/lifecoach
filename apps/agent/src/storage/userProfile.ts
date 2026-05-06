import { type UserProfile, emptyUserProfile } from '@lifecoach/shared-types';
import yaml from 'js-yaml';

/**
 * Minimal bucket surface we depend on. @google-cloud/storage's Bucket
 * implements this; tests use an in-memory substitute.
 */
export interface BucketLike {
  file(path: string): {
    download(): Promise<[Buffer]>;
    save(contents: string | Buffer, opts?: unknown): Promise<unknown>;
    exists(): Promise<[boolean]>;
  };
}

export interface UserProfileStore {
  read(uid: string): Promise<UserProfile>;
  /** Overwrite the whole doc — used by the /settings PATCH path. */
  write(uid: string, profile: UserProfile): Promise<void>;
  /**
   * Schema-free dotted-path write. The agent's update_user_profile tool
   * calls this. Any path is accepted; missing intermediate objects are
   * created on the fly.
   */
  updatePath(uid: string, path: string, value: unknown): Promise<UserProfile>;
  /**
   * Read the value at a dotted path. Returns null when the path doesn't
   * exist (or any intermediate object is missing). Used by the diff
   * surface in the chat UI: the tool reads `before` here, writes the new
   * value, and returns both in the functionResponse.
   */
  readPath(uid: string, path: string): Promise<unknown>;
}

export function userYamlPath(uid: string): string {
  return `users/${uid}/user.yaml`;
}

/**
 * Immutable dotted-path write. Creates intermediate objects as needed.
 * Exported for tests.
 */
export function setDottedPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const clone = structuredClone(obj);
  const parts = path.split('.');
  let cursor: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    const existing = cursor[key];
    if (
      existing === null ||
      existing === undefined ||
      typeof existing !== 'object' ||
      Array.isArray(existing)
    ) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
  return clone;
}

/**
 * Read the value at a dotted path. Returns `undefined` if any segment is
 * missing — callers in the agent treat undefined and "key absent" the
 * same way for diff purposes.
 */
export function getDottedPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const key of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

export function createUserProfileStore(deps: { bucket: BucketLike }): UserProfileStore {
  const { bucket } = deps;

  async function read(uid: string): Promise<UserProfile> {
    const file = bucket.file(userYamlPath(uid));
    let text: string;
    try {
      const [buf] = await file.download();
      text = buf.toString('utf8');
    } catch (err: unknown) {
      if (isNotFound(err)) return emptyUserProfile();
      throw err;
    }
    try {
      const parsed = yaml.load(text);
      if (parsed === null || parsed === undefined) return emptyUserProfile();
      if (typeof parsed !== 'object' || Array.isArray(parsed)) return emptyUserProfile();
      return parsed as UserProfile;
    } catch {
      // Corrupt YAML — fall back to the starter template rather than 500
      // every subsequent turn for this user. The PATCH /profile endpoint
      // will overwrite cleanly on the next write.
      return emptyUserProfile();
    }
  }

  async function write(uid: string, profile: UserProfile): Promise<void> {
    const text = yaml.dump(profile, { lineWidth: 120, noRefs: true });
    await bucket.file(userYamlPath(uid)).save(text, {
      contentType: 'application/yaml',
      resumable: false,
    });
  }

  async function updatePath(uid: string, path: string, value: unknown): Promise<UserProfile> {
    if (!path || typeof path !== 'string') {
      throw new Error('path is required');
    }
    const current = await read(uid);
    const updated = setDottedPath(current as Record<string, unknown>, path, value);
    await write(uid, updated);
    return updated;
  }

  async function readPath(uid: string, path: string): Promise<unknown> {
    if (!path || typeof path !== 'string') return undefined;
    const profile = await read(uid);
    return getDottedPath(profile as Record<string, unknown>, path);
  }

  return { read, write, updatePath, readPath };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 404 || e.code === '404') return true;
  return typeof e.message === 'string' && e.message.includes('not found');
}
