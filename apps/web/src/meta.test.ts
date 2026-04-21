import { describe, expect, it } from 'vitest';
import { APP_NAME } from './meta.js';

describe('web app meta', () => {
  it('identifies itself', () => {
    expect(APP_NAME).toBe('@lifecoach/web');
  });
});
