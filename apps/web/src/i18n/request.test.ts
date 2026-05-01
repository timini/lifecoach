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
});
