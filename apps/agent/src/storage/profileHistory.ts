/**
 * Append-only audit log of profile mutations. One JSONL file per user at
 * `users/{uid}/profile-history.jsonl`. JSONL (not YAML) because:
 *   - appends are O(content length) without re-serialising the whole file
 *   - parsing is a line-by-line split rather than a structured load
 *   - per-line corruption is recoverable (skip the bad line, keep the rest)
 *
 * Each line is one entry: `{path, before, after, at}`. Consumers (the
 * /profile endpoint, the YamlTree's per-leaf timestamp) walk the entries
 * in order and pick the most recent `at` for each path. The file may grow
 * unboundedly in principle; in practice the ~3-5 facts/day cadence keeps
 * it well under any storage threshold worth caring about for years.
 */

/**
 * before/after carry whatever JSON-serialisable value the profile path
 * holds (string, number, boolean, null, array, object). Typed as
 * `unknown` rather than re-declaring a local JsonValue — only the disk
 * encoder/decoder cares about the exact shape.
 */
export interface ProfileHistoryEntry {
  /** Dotted path that was written, e.g. `family.children[0].name`. */
  path: string;
  /** Value before the write (`undefined` is encoded as null on disk). */
  before: unknown;
  /** Value after the write. */
  after: unknown;
  /** ISO 8601 timestamp; ms-precision when the writer is JS. */
  at: string;
}

/** Minimal bucket surface — same as UserProfileStore's BucketLike. */
interface BucketLike {
  file(path: string): {
    download(): Promise<[Buffer]>;
    save(contents: string | Buffer, opts?: unknown): Promise<unknown>;
    exists(): Promise<[boolean]>;
  };
}

export interface ProfileHistoryStore {
  /** Append a single entry. Tolerates a missing file (creates it). */
  append(uid: string, entry: ProfileHistoryEntry): Promise<void>;
  /**
   * Read all entries in chronological order (oldest first). Returns [] if
   * the file is missing or unparseable. `limit`, when provided, returns
   * the most recent N entries (still in chronological order).
   */
  read(uid: string, opts?: { limit?: number }): Promise<ProfileHistoryEntry[]>;
}

export function profileHistoryPath(uid: string): string {
  return `users/${uid}/profile-history.jsonl`;
}

export function createProfileHistoryStore(deps: { bucket: BucketLike }): ProfileHistoryStore {
  const { bucket } = deps;

  async function readAll(uid: string): Promise<string> {
    const file = bucket.file(profileHistoryPath(uid));
    try {
      const [buf] = await file.download();
      return buf.toString('utf8');
    } catch (err: unknown) {
      if (isNotFound(err)) return '';
      throw err;
    }
  }

  async function append(uid: string, entry: ProfileHistoryEntry): Promise<void> {
    // Read-modify-write. JSONL would prefer a true append API but GCS
    // bucket.save() rewrites the object — that's fine here, the file is
    // small and writes are user-rate-limited (one per profile fact).
    const existing = await readAll(uid);
    const line = `${JSON.stringify(serialise(entry))}\n`;
    const next =
      existing.endsWith('\n') || existing.length === 0 ? existing + line : `${existing}\n${line}`;
    await bucket.file(profileHistoryPath(uid)).save(next, {
      contentType: 'application/jsonl',
      resumable: false,
    });
  }

  async function read(uid: string, opts?: { limit?: number }): Promise<ProfileHistoryEntry[]> {
    const text = await readAll(uid);
    if (!text) return [];
    const entries: ProfileHistoryEntry[] = [];
    for (const line of text.split(/\n+/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const e = deserialise(parsed);
        if (e) entries.push(e);
      } catch {
        // Skip the malformed line; don't abort the whole read.
      }
    }
    if (opts?.limit && opts.limit > 0 && entries.length > opts.limit) {
      return entries.slice(entries.length - opts.limit);
    }
    return entries;
  }

  return { append, read };
}

/** Replace `undefined` (path didn't previously exist) with null for JSON. */
function serialise(entry: ProfileHistoryEntry): ProfileHistoryEntry {
  const before = entry.before === undefined ? null : entry.before;
  return { path: entry.path, before, after: entry.after, at: entry.at };
}

function deserialise(raw: unknown): ProfileHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== 'string' || typeof r.at !== 'string') return null;
  return {
    path: r.path,
    before: r.before ?? null,
    after: r.after ?? null,
    at: r.at,
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 404 || e.code === '404') return true;
  return typeof e.message === 'string' && e.message.includes('not found');
}
