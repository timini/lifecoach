import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const workspaceAliases = {
  '@lifecoach/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
  '@lifecoach/user-state': resolve(__dirname, '../../packages/user-state/src/index.ts'),
  '@lifecoach/config': resolve(__dirname, '../../packages/config/src/index.ts'),
  '@lifecoach/testing': resolve(__dirname, '../../packages/testing/src/index.ts'),
  '@lifecoach/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
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
      //
      // useChatStream is a React hook (useState/useEffect over fetch
      // streaming) — same shape as a .tsx, so it rides on the same e2e
      // (chat-persistence.spec.ts). sentry.ts is the SDK init shim; its
      // observable behaviour is "Sentry events show up in the dashboard,"
      // which a unit test can't verify.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.tsx',
        'src/lib/firebase.ts',
        'src/lib/sentry.ts',
        'src/lib/useChatStream.ts',
      ],
      thresholds: {
        // Branches at 80 to match the agent package — the remaining gap is
        // defensive fallbacks (SSR guards, JSON.parse catches, quota
        // catches). Lines/statements/functions stay ≥90.
        lines: 90,
        branches: 80,
        functions: 90,
        statements: 90,
      },
    },
  },
});
