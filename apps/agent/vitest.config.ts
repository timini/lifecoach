import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Workspace packages publish to dist/ (so Node.js can load them at runtime),
// but tests read source .ts files so tsc builds aren't required to run tests.
const workspaceAliases = {
  '@lifecoach/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
  '@lifecoach/user-state': resolve(__dirname, '../../packages/user-state/src/index.ts'),
  '@lifecoach/config': resolve(__dirname, '../../packages/config/src/index.ts'),
  '@lifecoach/testing': resolve(__dirname, '../../packages/testing/src/index.ts'),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
      thresholds: {
        // Statements/lines/functions must stay high. Branches is 80 because
        // many branches are defensive catch blocks (fetch failures, bad
        // JSON) whose paths are legitimately hard to exercise without weird
        // mocks. Phase 11 adds integration tests that'll close the gap.
        lines: 90,
        branches: 80,
        functions: 90,
        statements: 90,
      },
    },
  },
});
