import { describe, expect, test, vi } from 'vitest';

interface MockStore<T> {
  get: (key: string) => T | undefined;
}

const cookieStore: MockStore<{ value: string }> = { get: () => undefined };
const headerStore: MockStore<string> = { get: () => undefined };

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => headerStore,
}));

vi.mock('next-intl/server', () => ({
  getRequestConfig: (factory: () => Promise<unknown>) => factory,
}));

import requestConfig from './request';

const factory = requestConfig as unknown as () => Promise<{
  locale: string;
  messages: unknown;
}>;

describe('i18n/request', () => {
  test('honours NEXT_LOCALE cookie when set to a known locale', async () => {
    cookieStore.get = (k) => (k === 'NEXT_LOCALE' ? { value: 'fr' } : undefined);
    headerStore.get = () => undefined;
    const cfg = await factory();
    expect(cfg.locale).toBe('fr');
    expect(cfg.messages).toBeTruthy();
  });

  test('falls back to Accept-Language when no cookie', async () => {
    cookieStore.get = () => undefined;
    headerStore.get = () => 'fr-CA,fr;q=0.9,en;q=0.5';
    const cfg = await factory();
    expect(cfg.locale).toBe('fr');
  });

  test('uses default (en) when neither cookie nor Accept-Language match', async () => {
    cookieStore.get = () => undefined;
    headerStore.get = () => 'de-DE,de;q=0.9';
    const cfg = await factory();
    expect(cfg.locale).toBe('en');
  });

  test('uses default when Accept-Language is missing', async () => {
    cookieStore.get = () => undefined;
    headerStore.get = () => undefined;
    const cfg = await factory();
    expect(cfg.locale).toBe('en');
  });

  test('ignores unknown cookie values and falls back to header', async () => {
    cookieStore.get = () => ({ value: 'xx' });
    headerStore.get = () => 'fr';
    const cfg = await factory();
    expect(cfg.locale).toBe('fr');
  });

  test('honours q-values when they reorder document order', async () => {
    cookieStore.get = () => undefined;
    // en appears first but is q=0.2; fr is q=0.9 so fr wins.
    headerStore.get = () => 'en;q=0.2, fr;q=0.9';
    const cfg = await factory();
    expect(cfg.locale).toBe('fr');
  });

  test('treats missing q as 1.0 and breaks ties on document order', async () => {
    cookieStore.get = () => undefined;
    // Both default to q=1.0, so en (first) wins.
    headerStore.get = () => 'en, fr';
    const cfg = await factory();
    expect(cfg.locale).toBe('en');
  });

  test('drops tags with q=0 (explicitly disallowed)', async () => {
    cookieStore.get = () => undefined;
    // fr is explicitly q=0 → not acceptable; en is the supported fallback.
    headerStore.get = () => 'fr;q=0, en';
    const cfg = await factory();
    expect(cfg.locale).toBe('en');
  });
});
