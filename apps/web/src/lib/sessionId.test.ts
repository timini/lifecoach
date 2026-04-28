import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSessionIdForUid, getSessionId, setSessionId } from './sessionId';

/**
 * Vitest defaults to a node environment for this app, so we ship a tiny
 * in-memory `window.localStorage` shim instead of pulling in jsdom for the
 * sake of one helper. crypto.randomUUID is available globally in node 18+.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessionId helpers', () => {
  it('returns null for an unknown uid', () => {
    expect(getSessionId('alice')).toBeNull();
  });

  it('round-trips a uid → sessionId mapping', () => {
    setSessionId('alice', 'sess-1');
    expect(getSessionId('alice')).toBe('sess-1');
  });

  it('keeps separate sessionIds for different uids', () => {
    setSessionId('alice', 'sess-a');
    setSessionId('bob', 'sess-b');
    expect(getSessionId('alice')).toBe('sess-a');
    expect(getSessionId('bob')).toBe('sess-b');
  });

  it('overwrites an existing sessionId for the same uid', () => {
    setSessionId('alice', 'sess-old');
    setSessionId('alice', 'sess-new');
    expect(getSessionId('alice')).toBe('sess-new');
  });

  it('survives a corrupt localStorage value (returns null, recovers on write)', () => {
    window.localStorage.setItem('lifecoach.sessionIdByUid', 'not-json');
    expect(getSessionId('alice')).toBeNull();
    setSessionId('alice', 'sess-1');
    expect(getSessionId('alice')).toBe('sess-1');
  });

  it('survives a non-object JSON value', () => {
    window.localStorage.setItem('lifecoach.sessionIdByUid', '[1,2,3]');
    expect(getSessionId('alice')).toBeNull();
  });

  it('ignores empty uid', () => {
    setSessionId('', 'sess-x');
    expect(getSessionId('')).toBeNull();
  });

  describe('ensureSessionIdForUid', () => {
    it('mints + stores when uid has no entry', () => {
      const sid = ensureSessionIdForUid('alice');
      expect(sid).toMatch(/^[0-9a-f-]{36}$/);
      expect(getSessionId('alice')).toBe(sid);
    });

    it('returns the existing sessionId on the second call', () => {
      const a = ensureSessionIdForUid('alice');
      const b = ensureSessionIdForUid('alice');
      expect(a).toBe(b);
    });

    it('mints distinct sessionIds for distinct uids', () => {
      const a = ensureSessionIdForUid('alice');
      const b = ensureSessionIdForUid('bob');
      expect(a).not.toBe(b);
    });
  });
});
