import { describe, expect, it } from 'vitest';
import { formatModifiedAt, lastModifiedByPath, pathKey } from './yaml-tree';

describe('pathKey', () => {
  it('joins object keys with `.`', () => {
    expect(pathKey(['family', 'partner', 'name'])).toBe('family.partner.name');
  });

  it('renders array indices as bracketed integers', () => {
    expect(pathKey(['family', 'children', 0, 'name'])).toBe('family.children[0].name');
  });

  it('returns empty string for an empty path', () => {
    expect(pathKey([])).toBe('');
  });

  it('handles a leading array index without a leading dot', () => {
    expect(pathKey([0, 'name'])).toBe('[0].name');
  });
});

describe('lastModifiedByPath', () => {
  it('keeps the latest `at` per path', () => {
    const out = lastModifiedByPath([
      { path: 'name', at: '2026-05-01T10:00:00Z' },
      { path: 'name', at: '2026-05-06T10:00:00Z' },
      { path: 'family.partner.name', at: '2026-05-04T10:00:00Z' },
    ]);
    expect(out).toEqual({
      name: '2026-05-06T10:00:00Z',
      'family.partner.name': '2026-05-04T10:00:00Z',
    });
  });

  it('returns {} for an empty input', () => {
    expect(lastModifiedByPath([])).toEqual({});
  });

  it('preserves an out-of-order log (later entry chronologically still wins)', () => {
    const out = lastModifiedByPath([
      { path: 'name', at: '2026-05-06T10:00:00Z' },
      { path: 'name', at: '2026-05-01T10:00:00Z' },
    ]);
    expect(out.name).toBe('2026-05-06T10:00:00Z');
  });
});

describe('formatModifiedAt', () => {
  const now = new Date('2026-05-06T18:00:00Z');

  it('renders "just now" within the last minute', () => {
    expect(formatModifiedAt('2026-05-06T17:59:30Z', now)).toBe('just now');
  });

  it('renders "Nm ago" within the last hour', () => {
    expect(formatModifiedAt('2026-05-06T17:55:00Z', now)).toBe('5m ago');
  });

  it('renders "Nh ago" within the last day', () => {
    expect(formatModifiedAt('2026-05-06T15:00:00Z', now)).toBe('3h ago');
  });

  it('renders "yesterday" between 24h and 48h', () => {
    expect(formatModifiedAt('2026-05-05T17:00:00Z', now)).toBe('yesterday');
  });

  it('renders "Nd ago" within the last week', () => {
    expect(formatModifiedAt('2026-05-03T18:00:00Z', now)).toBe('3d ago');
  });

  it('renders a short locale date for older timestamps', () => {
    const out = formatModifiedAt('2026-04-15T18:00:00Z', now);
    expect(out).toMatch(/Apr/);
  });

  it('returns empty string for invalid input', () => {
    expect(formatModifiedAt('not-a-date', now)).toBe('');
  });
});
