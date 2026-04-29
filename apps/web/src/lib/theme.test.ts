import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  type ThemeChoice,
  applyResolvedTheme,
  getThemeChoice,
  resolveTheme,
  setTheme,
} from './theme';

interface FakeStorage {
  store: Record<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
}

function makeStorage(): FakeStorage {
  return {
    store: {},
    getItem(k) {
      return this.store[k] ?? null;
    },
    setItem(k, v) {
      this.store[k] = v;
    },
    removeItem(k) {
      delete this.store[k];
    },
    clear() {
      this.store = {};
    },
  };
}

function stubBrowser(prefersDark: boolean): {
  storage: FakeStorage;
  htmlAttr: () => string | null;
} {
  const storage = makeStorage();
  let dataTheme: string | null = null;
  vi.stubGlobal('window', {
    localStorage: storage,
    matchMedia: (q: string) => ({
      matches: q.includes('dark') ? prefersDark : false,
    }),
  });
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (k: string, v: string) => {
        if (k === 'data-theme') dataTheme = v;
      },
      getAttribute: (k: string) => (k === 'data-theme' ? dataTheme : null),
      removeAttribute: (k: string) => {
        if (k === 'data-theme') dataTheme = null;
      },
    },
  });
  return { storage, htmlAttr: () => dataTheme };
}

describe('theme', () => {
  let env: ReturnType<typeof stubBrowser>;

  beforeEach(() => {
    env = stubBrowser(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to system when no choice is stored', () => {
    expect(getThemeChoice()).toBe('system');
  });

  it('persists the choice to localStorage', () => {
    setTheme('dark');
    expect(env.storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getThemeChoice()).toBe('dark');
  });

  it('resolves system choice against prefers-color-scheme=dark', () => {
    env = stubBrowser(true);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('resolves system choice against prefers-color-scheme=light', () => {
    expect(resolveTheme('system')).toBe('light');
  });

  it('resolves explicit choices verbatim', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('applies the resolved theme to <html data-theme>', () => {
    applyResolvedTheme('dark');
    expect(env.htmlAttr()).toBe('dark');
    applyResolvedTheme('light');
    expect(env.htmlAttr()).toBe('light');
  });

  it('setTheme updates storage AND the DOM in one call', () => {
    setTheme('dark');
    expect(env.htmlAttr()).toBe('dark');
    setTheme('light');
    expect(env.htmlAttr()).toBe('light');
  });

  it('setTheme("system") follows the current matchMedia value', () => {
    env = stubBrowser(true);
    setTheme('system');
    expect(env.htmlAttr()).toBe('dark');
    expect(getThemeChoice()).toBe('system');
  });

  it('rejects unknown values defensively', () => {
    expect(() => setTheme('purple' as ThemeChoice)).toThrow();
  });

  it('returns "system" when localStorage holds an unknown value', () => {
    env.storage.setItem(THEME_STORAGE_KEY, 'mauve');
    expect(getThemeChoice()).toBe('system');
  });
});
