import { describe, expect, test } from 'vitest';
import { defaultLocale, isLocale, locales } from './routing';

describe('i18n/routing', () => {
  test('locales include en and fr', () => {
    expect(locales).toEqual(['en', 'fr']);
  });

  test('defaultLocale is en', () => {
    expect(defaultLocale).toBe('en');
  });

  test('isLocale returns true for known locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(true);
  });

  test('isLocale returns false for unknown / falsy values', () => {
    expect(isLocale('de')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('')).toBe(false);
  });
});
