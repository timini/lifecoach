import { expect, test } from '@playwright/test';
import {
  readE2ECreds,
  sendChat,
  signInAsTestUser,
  signOutTestUser,
  waitForAssistantReply,
} from './fixtures';

/**
 * Round-trips the user expectation: sign in → send a message → sign out →
 * sign back in as the same user → previous messages reload from Firestore.
 *
 * Runs unchanged against dev (default) and prod once Email/Password is
 * enabled and the e2e test user is provisioned in each environment.
 */
test('chat history persists across logout and sign-in', async ({ page }) => {
  const creds = readE2ECreds();
  // Use a unique token in the message so we can match exactly the message
  // we sent on this run, ignoring any leftover history from prior runs.
  const token = `e2e-${Date.now().toString(36)}`;

  await page.goto('/');

  // Wait for the initial anon sign-in to settle. ChatWindow shows
  // "Signing you in…" until then; once the user is set, the chat-window-
  // state seam is mounted with data-uid populated. (We can't rely on the
  // "Say hi to get started." placeholder anymore — the day-of-greeting
  // kickoff turn replaces it as soon as auth settles.)
  await expect(page.locator('[data-testid="chat-window-state"][data-uid]')).toBeAttached();

  await signInAsTestUser(page, creds);

  // After sign-in, ChatWindow's history-load effect rehydrates the
  // transcript. Our test user might already have history from a prior
  // run — that's fine; we only assert on the new message we send below.
  await sendChat(page, `please remember the token ${token} for me`);
  await waitForAssistantReply(page);

  // Confirm our user message is in the transcript before signing out, so a
  // failure later is unambiguous (history reload broke vs send broke).
  await expect(page.getByText(token)).toBeVisible();

  await signOutTestUser(page);

  // Sign-out triggers a fresh anonymous sign-in. The token from the
  // previous user must not appear in the new (empty) anon transcript.
  await expect(page.getByText(token)).toHaveCount(0, { timeout: 15_000 });

  await signInAsTestUser(page, creds);

  // Same uid → same per-uid sessionId → /history returns the previous
  // transcript including the token we sent earlier.
  await expect(page.getByText(token)).toBeVisible({ timeout: 15_000 });
});

/**
 * Day-rhythm: a fresh page-load on an empty session should kick off the
 * agent automatically (no user typing) and surface the sidebar so the user
 * can see today's session listed. Asserting on the structural seams
 * (`chat-window-state`, the drawer trigger button) keeps this stable
 * regardless of the greeting copy the LLM picks.
 */
test('first load fires the day-of greeting and lists the session in the drawer', async ({
  page,
}) => {
  await page.goto('/');

  // Wait for auth + sessionId to settle so the kickoff effect can fire.
  await expect(page.locator('[data-testid="chat-window-state"][data-uid]')).toBeAttached();
  await expect(page.locator('[data-testid="chat-window-state"]')).toHaveAttribute(
    'data-busy',
    'false',
    { timeout: 30_000 },
  );

  // After the kickoff turn, the empty-state placeholder is gone and at least
  // one assistant bubble is on screen.
  await expect(page.getByText(/say hi to get started/i)).toHaveCount(0);
  await expect(page.locator('article, [data-from="assistant"]').first()).toBeVisible();

  // Open the sidebar drawer; today's session entry shows the Today pill.
  await page.getByLabel(/open sessions/i).click();
  await expect(page.getByRole('heading', { name: /previous chats/i })).toBeVisible();
  await expect(page.getByText(/^Today$/)).toBeVisible();
});
