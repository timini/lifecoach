import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './meta.js';

describe('shared-types meta', () => {
  it('identifies itself', () => {
    expect(PACKAGE_NAME).toBe('@lifecoach/shared-types');
  });
});
