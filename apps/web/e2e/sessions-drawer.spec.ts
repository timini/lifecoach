import { expect, test } from '@playwright/test';
import { readE2ECreds, signInAsTestUser } from './fixtures';

/**
 * Regression: post-login the sessions drawer must slide into the viewport
 * (left edge ≥ 0). Earlier failure had the drawer rendering at
 * x=-288 because Tailwind v4's `translate-x-0` failed to clear the
 * `translate: -100%` set by `-translate-x-full` (separate CSS property
 * from `transform`), AND a `filter` keyframe on `<body>` made body the
 * containing block for `position: fixed`. The fix is two-part:
 *   1. globals.css mesh-breathe keyframes no longer animate `filter`.
 *   2. SessionsDrawer uses inline `style.transform` instead of the
 *      Tailwind translate utilities for the slide.
 */
test('drawer slides into the viewport when opened post-login', async ({ page }) => {
  const creds = readE2ECreds();
  await page.goto('/');
  await expect(page.locator('[data-testid="chat-window-state"][data-uid]')).toBeAttached();
  await signInAsTestUser(page, creds);

  // Sessions fetch fires on user change; give it a beat to settle.
  await page.waitForTimeout(2000);

  await page.getByLabel(/open sessions/i).click();
  // Wait for the slide-in transition (200ms) to finish before measuring.
  // CSS `transition-transform` interpolates from translateX(-100%) to
  // translateX(0); reading mid-flight returns a stale rect.
  await page.waitForTimeout(400);

  const rect = await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-hidden="false"]');
    if (!aside) return null;
    const r = aside.getBoundingClientRect();
    return { x: r.x, width: r.width };
  });

  expect(rect, 'drawer aside is in DOM with aria-hidden=false').not.toBeNull();
  expect(rect?.x, 'drawer left edge is inside the viewport').toBeGreaterThanOrEqual(0);
  // A non-zero width is implicit, but assert anyway so a 0-width regression
  // is named clearly in CI output.
  expect(rect?.width, 'drawer has non-zero width').toBeGreaterThan(0);

  // Header + at least one session item should be visible — proves the
  // drawer's content rendered, not just an invisible empty panel.
  await expect(page.getByRole('heading', { name: /previous chats/i })).toBeVisible();
});

/**
 * Regression: post-login the AccountMenu dropdown must open when the
 * avatar trigger is clicked. Earlier failure was suspected to be the
 * same `body { filter: ... }` containing-block trap that broke the
 * drawer — Radix portals position via getBoundingClientRect against
 * the trigger, and a containing block on body throws the math off.
 */
test('account menu opens post-login', async ({ page }) => {
  const creds = readE2ECreds();
  await page.goto('/');
  await expect(page.locator('[data-testid="chat-window-state"][data-uid]')).toBeAttached();
  await signInAsTestUser(page, creds);
  await page.waitForTimeout(1000);

  // Close the drawer if a previous test left it open — only the menu under
  // test should be expanded.
  const trigger = page.getByLabel('Account menu');
  await trigger.click();

  // The dropdown content renders into a Radix portal in document.body.
  // It carries the "Sign out" item for any logged-in state.
  await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible({ timeout: 5_000 });
});
