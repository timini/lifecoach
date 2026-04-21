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
      // React/Next components (*.tsx) are covered by Playwright e2e tests
      // (Phase 11), not by unit tests — so they're excluded from the unit
      // coverage gate. Everything else (server routes, lib/*, utils) must
      // stay above 90%.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.tsx', 'src/lib/firebase.ts'],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
