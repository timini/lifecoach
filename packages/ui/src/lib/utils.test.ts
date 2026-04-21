import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins multiple class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values', () => {
    expect(cn('a', false && 'no', null, undefined, 'b')).toBe('a b');
  });

  it('resolves Tailwind class conflicts by keeping the last one', () => {
    // tailwind-merge — px-4 and px-8 are the same utility family; last wins.
    expect(cn('px-4', 'px-8')).toBe('px-8');
  });

  it('handles arrays and objects (clsx shape)', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });

  it('returns empty string on no input', () => {
    expect(cn()).toBe('');
  });
});
