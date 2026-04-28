import { describe, expect, it } from 'vitest';
import { PRACTICE_METADATA, practiceEnabledPath } from './practices.js';

describe('PRACTICE_METADATA', () => {
  it('has unique ids', () => {
    const ids = PRACTICE_METADATA.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has label and description', () => {
    for (const p of PRACTICE_METADATA) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('ids are snake_case so they round-trip through user.yaml dotted paths', () => {
    for (const p of PRACTICE_METADATA) {
      expect(p.id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('practiceEnabledPath', () => {
  it('builds the enabled-flag path under practices.{id}', () => {
    expect(practiceEnabledPath('evening_gratitude')).toBe('practices.evening_gratitude.enabled');
  });
});
