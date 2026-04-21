import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const workspaceAliases = {
  '@lifecoach/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
  '@lifecoach/user-state': resolve(__dirname, '../../packages/user-state/src/index.ts'),
  '@lifecoach/config': resolve(__dirname, '../../packages/config/src/index.ts'),
  '@lifecoach/testing': resolve(__dirname, '../../packages/testing/src/index.ts'),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
