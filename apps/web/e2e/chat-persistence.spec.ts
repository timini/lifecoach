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
  // "Signing you in…" until then; "Say hi to get started." is the empty-
  // state placeholder shown once user is set and messages is empty.
  await expect(page.getByText(/say hi to get started/i)).toBeVisible();

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

  // Sign-out triggers a fresh anonymous sign-in. The empty-state copy
  // returns once the new (empty) anon session settles.
  await expect(page.getByText(/say hi to get started/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(token)).toHaveCount(0);

  await signInAsTestUser(page, creds);

  // Same uid → same per-uid sessionId → /history returns the previous
  // transcript including the token we sent earlier.
  await expect(page.getByText(token)).toBeVisible({ timeout: 15_000 });
});
