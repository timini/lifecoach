import { type GoalUpdate, GoalUpdateSchema } from '@lifecoach/shared-types';
import type { BucketLike } from './userProfile.js';

export interface GoalUpdatesStore {
  append(uid: string, entry: Omit<GoalUpdate, 'timestamp'>): Promise<GoalUpdate>;
  recent(uid: string, limit: number): Promise<GoalUpdate[]>;
}

export function goalUpdatesPath(uid: string): string {
  return `users/${uid}/goal_updates.json`;
}

export function createGoalUpdatesStore(deps: {
  bucket: BucketLike;
  now?: () => Date;
}): GoalUpdatesStore {
  const now = deps.now ?? (() => new Date());

  async function readAll(uid: string): Promise<GoalUpdate[]> {
    const file = deps.bucket.file(goalUpdatesPath(uid));
    try {
      const [buf] = await file.download();
      const parsed = JSON.parse(buf.toString('utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      // Validate entries, silently drop any that don't match the schema.
      const out: GoalUpdate[] = [];
      for (const e of parsed) {
        const r = GoalUpdateSchema.safeParse(e);
        if (r.success) out.push(r.data);
      }
      return out;
    } catch (err: unknown) {
      // Missing file or bad JSON → start fresh.
      if (isNotFound(err) || err instanceof SyntaxError) return [];
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { name?: string }).name === 'SyntaxError'
      )
        return [];
      return [];
    }
  }

  return {
    async append(uid, entry) {
      const full: GoalUpdate = GoalUpdateSchema.parse({
        ...entry,
        timestamp: now().toISOString(),
      });
      const all = await readAll(uid);
      all.push(full);
      await deps.bucket.file(goalUpdatesPath(uid)).save(JSON.stringify(all, null, 2), {
        contentType: 'application/json',
        resumable: false,
      });
      return full;
    },
    async recent(uid, limit) {
      const all = await readAll(uid);
      return all.slice(-limit);
    },
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 404 || e.code === '404') return true;
  return typeof e.message === 'string' && e.message.includes('not found');
}
