import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Shared helpers for the e2e specs. Keeps individual spec files small.
 */

export interface E2ECreds {
  email: string;
  password: string;
}

export function readE2ECreds(): E2ECreds {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set. ' +
        'Provision the test user with `pnpm tsx scripts/provision-e2e-user.ts ' +
        '--project=<gcp-project-id>` and pull the password via ' +
        '`gcloud secrets versions access latest --secret=E2E_TEST_PASSWORD`.',
    );
  }
  return { email, password };
}

/**
 * Wait for the test hook installed by `apps/web/src/lib/firebase.ts` to
 * appear on `window`. Race-safe: the hook is installed as a module-load
 * side effect of ChatWindow's import chain, but Playwright may evaluate
 * before React has mounted on slow networks.
 */
export async function waitForE2EHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as { __lifecoachE2E?: unknown }).__lifecoachE2E === 'object',
    null,
    { timeout: 15_000 },
  );
}

export async function signInAsTestUser(page: Page, creds: E2ECreds): Promise<void> {
  await waitForE2EHook(page);
  await page.evaluate(async ({ email, password }) => {
    const hook = (
      window as { __lifecoachE2E?: { signInWithEmail: (e: string, p: string) => Promise<unknown> } }
    ).__lifecoachE2E;
    if (!hook) throw new Error('window.__lifecoachE2E missing');
    await hook.signInWithEmail(email, password);
  }, creds);
}

export async function signOutTestUser(page: Page): Promise<void> {
  await waitForE2EHook(page);
  await page.evaluate(async () => {
    const hook = (window as { __lifecoachE2E?: { signOut: () => Promise<unknown> } })
      .__lifecoachE2E;
    if (!hook) throw new Error('window.__lifecoachE2E missing');
    await hook.signOut();
  });
}

/**
 * Find the chat input. ChatWindow uses a single text input with placeholder
 * "Type a message…" — match on the placeholder which is stable copy.
 */
export function chatInput(page: Page): Locator {
  return page.getByPlaceholder('Type a message…');
}

export async function sendChat(page: Page, text: string): Promise<void> {
  const input = chatInput(page);
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * Wait for the assistant to finish the current turn. The Send button is
 * disabled while `busy` is true (see ChatWindow.tsx footer); becomes
 * enabled again once `setBusy(false)` runs at the end of `sendText`.
 *
 * Cap at 45s — the cold-path round-trip (Vertex + tools) can hit 30s.
 */
export async function waitForAssistantReply(page: Page, timeoutMs = 45_000): Promise<void> {
  // Need text in the box to enable the Send button so the disabled-toggle
  // signal is unambiguous; we only inspect aria-disabled.
  const sendBtn = page.getByRole('button', { name: 'Send' });
  await expect
    .poll(async () => await sendBtn.isDisabled(), {
      timeout: timeoutMs,
      message: 'assistant did not finish replying within timeout',
    })
    .toBe(false);
}
