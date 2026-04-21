import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './meta.js';

describe('testing meta', () => {
  it('identifies itself', () => {
    expect(PACKAGE_NAME).toBe('@lifecoach/testing');
  });
});
