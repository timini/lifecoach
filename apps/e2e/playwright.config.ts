import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the chat-persistence e2e (and any future e2e specs).
 *
 * Designed to run against an already-deployed Cloud Run instance — there's
 * no `webServer` block, so you point it at dev or prod via E2E_BASE_URL and
 * provide test creds via E2E_TEST_EMAIL / E2E_TEST_PASSWORD. The same spec
 * runs unchanged against either environment.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
