import { describe, expect, it } from 'vitest';
import {
  deletePath,
  formatLeafValue,
  getPath,
  parseDottedPath,
  parseLeafInput,
  setPath,
} from './yamlTree.js';

describe('setPath', () => {
  it('sets a shallow key on an object', () => {
    expect(setPath({ a: 1 }, ['a'], 2)).toEqual({ a: 2 });
  });

  it('creates missing intermediate objects', () => {
    expect(setPath({}, ['a', 'b', 'c'], 3)).toEqual({ a: { b: { c: 3 } } });
  });

  it('replaces a primitive intermediate when drilling deeper', () => {
    expect(setPath({ a: 'x' }, ['a', 'b'], 2)).toEqual({ a: { b: 2 } });
  });

  it('writes into an array index', () => {
    expect(setPath({ xs: ['a', 'b', 'c'] }, ['xs', 1], 'B')).toEqual({ xs: ['a', 'B', 'c'] });
  });

  it('extends an array when writing past its end', () => {
    const out = setPath({ xs: ['a'] }, ['xs', 2], 'c') as { xs: unknown[] };
    expect(out.xs[2]).toBe('c');
    expect(out.xs.length).toBe(3);
  });

  it('does not mutate the input', () => {
    const input = { a: { b: 1 } };
    setPath(input, ['a', 'b'], 2);
    expect(input).toEqual({ a: { b: 1 } });
  });
});

describe('deletePath', () => {
  it('removes a shallow key', () => {
    expect(deletePath({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 });
  });

  it('removes an array item by index', () => {
    expect(deletePath({ xs: ['a', 'b', 'c'] }, ['xs', 1])).toEqual({ xs: ['a', 'c'] });
  });

  it('is a no-op when the path does not exist', () => {
    expect(deletePath({ a: 1 }, ['missing'])).toEqual({ a: 1 });
  });
});

describe('getPath', () => {
  it('returns the value at a nested path', () => {
    expect(getPath({ a: { b: 5 } }, ['a', 'b'])).toBe(5);
  });

  it('returns undefined on a missing path', () => {
    expect(getPath({ a: { b: 5 } }, ['a', 'c'])).toBeUndefined();
  });

  it('reads into an array', () => {
    expect(getPath({ xs: ['a', 'b'] }, ['xs', 1])).toBe('b');
  });
});

describe('parseLeafInput', () => {
  it('returns null for empty input', () => {
    expect(parseLeafInput('')).toBeNull();
    expect(parseLeafInput('   ')).toBeNull();
  });

  it('parses booleans', () => {
    expect(parseLeafInput('true')).toBe(true);
    expect(parseLeafInput('false')).toBe(false);
  });

  it('parses numbers', () => {
    expect(parseLeafInput('42')).toBe(42);
    expect(parseLeafInput('-3.14')).toBe(-3.14);
  });

  it('keeps plain strings as strings', () => {
    expect(parseLeafInput('hello')).toBe('hello');
    expect(parseLeafInput('refuge on weekends')).toBe('refuge on weekends');
  });

  it('preserves leading/trailing whitespace in strings (raw, not trimmed)', () => {
    expect(parseLeafInput('  hello  ')).toBe('  hello  ');
  });
});

describe('formatLeafValue', () => {
  it('renders null as empty', () => {
    expect(formatLeafValue(null)).toBe('');
  });

  it('renders primitives as their string form', () => {
    expect(formatLeafValue('hi')).toBe('hi');
    expect(formatLeafValue(42)).toBe('42');
    expect(formatLeafValue(true)).toBe('true');
  });
});

describe('parseDottedPath', () => {
  it('splits dotted keys', () => {
    expect(parseDottedPath('pets.name')).toEqual(['pets', 'name']);
  });

  it('drops empty segments', () => {
    expect(parseDottedPath('.a..b.')).toEqual(['a', 'b']);
  });

  it('parses numeric segments as array indices', () => {
    expect(parseDottedPath('items.0.name')).toEqual(['items', 0, 'name']);
  });
});
