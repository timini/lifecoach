import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      // Components (*.tsx) are covered by Playwright in Phase 11, not unit
      // tests. Unit coverage targets the pure utilities.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.tsx'],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 90,
        statements: 90,
      },
    },
  },
});
