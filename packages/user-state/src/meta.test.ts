import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './meta.js';

describe('user-state meta', () => {
  it('identifies itself', () => {
    expect(PACKAGE_NAME).toBe('@lifecoach/user-state');
  });
});
