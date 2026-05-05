import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// Runs every *.stories.tsx in packages/ui/src as a vitest test, with each
// story's `play()` function as the assertion. Coverage from these runs is
// reported alongside packages/ui's own lib/ unit tests.
export default defineConfig({
  plugins: [
    tailwindcss(),
    storybookTest({
      configDir: path.resolve(__dirname, '.storybook'),
    }),
  ],
  test: {
    name: 'ui-book',
    setupFiles: ['./.storybook/vitest.setup.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        '../../packages/ui/src/atoms/**/*.tsx',
        '../../packages/ui/src/molecules/**/*.tsx',
        '../../packages/ui/src/organisms/**/*.tsx',
        '../../packages/ui/src/templates/**/*.tsx',
      ],
      exclude: ['**/*.stories.tsx', '**/_*.tsx'],
    },
  },
});
