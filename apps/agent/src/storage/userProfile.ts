import {
  PROFILE_WRITABLE_PATHS,
  type UserProfile,
  UserProfileSchema,
  emptyUserProfile,
} from '@lifecoach/shared-types';
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
  write(uid: string, profile: UserProfile): Promise<void>;
  updatePath(uid: string, path: string, value: unknown): Promise<UserProfile>;
}

export function userYamlPath(uid: string): string {
  return `users/${uid}/user.yaml`;
}

const WRITABLE = new Set<string>(PROFILE_WRITABLE_PATHS);

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
    if (existing === null || existing === undefined || typeof existing !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
  return clone;
}

export function createUserProfileStore(deps: { bucket: BucketLike }): UserProfileStore {
  const { bucket } = deps;

  async function read(uid: string): Promise<UserProfile> {
    const file = bucket.file(userYamlPath(uid));
    try {
      const [buf] = await file.download();
      const parsed = yaml.load(buf.toString('utf8'));
      if (parsed === null || parsed === undefined) return emptyUserProfile();
      return UserProfileSchema.parse(parsed);
    } catch (err: unknown) {
      if (isNotFound(err)) return emptyUserProfile();
      throw err;
    }
  }

  async function write(uid: string, profile: UserProfile): Promise<void> {
    const validated = UserProfileSchema.parse(profile);
    const text = yaml.dump(validated, { lineWidth: 120, noRefs: true });
    await bucket.file(userYamlPath(uid)).save(text, {
      contentType: 'application/yaml',
      resumable: false,
    });
  }

  async function updatePath(uid: string, path: string, value: unknown): Promise<UserProfile> {
    if (!WRITABLE.has(path)) {
      throw new Error(
        `"${path}" is not a writable path. Use one of: ${PROFILE_WRITABLE_PATHS.join(', ')}`,
      );
    }
    const current = await read(uid);
    const updated = setDottedPath(current as Record<string, unknown>, path, value);
    const validated = UserProfileSchema.parse(updated);
    await write(uid, validated);
    return validated;
  }

  return { read, write, updatePath };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 404 || e.code === '404') return true;
  return typeof e.message === 'string' && e.message.includes('not found');
}
