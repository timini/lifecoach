/**
 * Long-term memory via mem0 (https://docs.mem0.ai).
 *
 * We call the REST API directly (POST /v1/memories/search, POST /v1/memories)
 * rather than via the `mem0ai` npm SDK — the SDK has conflicting peer deps
 * and we only need two endpoints. Both are best-effort: search returns an
 * empty array and save silently swallows errors rather than failing a turn.
 *
 * When MEM0_API_KEY is not configured, use `noopMemoryClient()` so the rest
 * of the system works unchanged and no memory features activate.
 */

export interface Memory {
  text: string;
}

export interface MemoryClient {
  search(uid: string, query: string, limit: number): Promise<Memory[]>;
  save(uid: string, text: string): Promise<void>;
}

export type MemoryFetcher = (url: string, init: RequestInit) => Promise<Response>;

const BASE = 'https://api.mem0.ai';

export function noopMemoryClient(): MemoryClient {
  return {
    async search() {
      return [];
    },
    async save() {
      /* noop */
    },
  };
}

export function createMem0MemoryClient(deps: {
  apiKey: string;
  fetcher?: MemoryFetcher;
  baseUrl?: string;
}): MemoryClient {
  const fetcher = deps.fetcher ?? ((url: string, init: RequestInit) => fetch(url, init));
  const baseUrl = deps.baseUrl ?? BASE;
  const headers = {
    authorization: `Token ${deps.apiKey}`,
    'content-type': 'application/json',
  };

  return {
    async search(uid, query, limit) {
      try {
        const res = await fetcher(`${baseUrl}/v1/memories/search/`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, user_id: uid, limit }),
        });
        if (res.status !== 200) return [];
        const parsed = (await res.json()) as unknown;
        return extractMemories(parsed);
      } catch {
        return [];
      }
    },
    async save(uid, text) {
      try {
        await fetcher(`${baseUrl}/v1/memories/`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id: uid,
            messages: [{ role: 'user', content: text }],
          }),
        });
      } catch {
        /* never crash a turn on a memory-save failure */
      }
    },
  };
}

/**
 * mem0's response shape has varied across versions: sometimes a bare array,
 * sometimes `{ results: [...] }`. Be tolerant.
 */
function extractMemories(parsed: unknown): Memory[] {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { results?: unknown })?.results)
      ? (parsed as { results: unknown[] }).results
      : [];
  const out: Memory[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const text = (entry as { memory?: unknown }).memory;
    if (typeof text === 'string' && text.length > 0) out.push({ text });
  }
  return out;
}
