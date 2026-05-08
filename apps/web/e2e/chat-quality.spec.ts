import { type Page, expect, test } from '@playwright/test';
import { sendChat, waitForAssistantReply } from './fixtures';
import { type JudgeTurn, judgeTranscript } from './judge';

/**
 * Chat-quality e2e: drive a 3-turn conversation through the deployed
 * web UI, capture each assistant reply, and ask Gemini (Vertex) to
 * judge whether each turn is substantive.
 *
 * Why this exists: `chat-persistence.spec.ts` only checks that *some*
 * assistant bubble appears; it would happily pass on the recovery-text
 * regressions we keep shipping ("Hmm, I missed that — could you say
 * it again?") and on /chat 500s where the user message persists but
 * no agent reply lands. This spec asserts the content of each turn,
 * not just presence.
 *
 * Runs against a fresh anonymous user (Playwright's per-test isolated
 * browser context produces a fresh Firebase anon uid each run), so the
 * agent treats every run as a brand-new conversation — no prior
 * history pollution.
 *
 * Auth model:
 *   - GOOGLE_APPLICATION_CREDENTIALS (or default ADC) lets the judge
 *     hit Vertex Gemini. WIF supplies it in CI; locally run
 *     `gcloud auth application-default login` once.
 */

// Three turns of an exchange that any sensible coach should handle:
// open with a greeting, share a concrete focus, then ask for next step.
const TURNS = [
  'good morning',
  'today I want to focus on shipping a new feature for my product',
  'what should I do first?',
];

// One spec-wide timeout — three turns + judge call can take ~2 min on
// a cold Cloud Run instance.
test.setTimeout(240_000);

async function captureNewAssistantText(page: Page, beforeBubbles: string[]): Promise<string> {
  const after = await page.locator('[data-from="assistant"]').allTextContents();
  if (after.length <= beforeBubbles.length) return '<NO ASSISTANT REPLY>';
  return after.slice(beforeBubbles.length).join('\n').trim() || '<NO ASSISTANT REPLY>';
}

async function runConversation(page: Page, turns: string[]): Promise<JudgeTurn[]> {
  const transcript: JudgeTurn[] = [];
  for (const userMsg of turns) {
    const before = await page.locator('[data-from="assistant"]').allTextContents();
    await sendChat(page, userMsg);
    await waitForAssistantReply(page);
    const assistant = await captureNewAssistantText(page, before);
    transcript.push({ user: userMsg, assistant });
    // Surface in the test log so a reader of the CI output can see what
    // the agent said even if the judge passes.
    // eslint-disable-next-line no-console
    console.log(`[chat-quality] user: ${userMsg}\n[chat-quality] assistant: ${assistant}\n---`);
  }
  return transcript;
}

test('three-turn conversation produces substantive replies (LLM judged)', async ({ page }) => {
  await page.goto('/');

  // Wait for the initial anon sign-in to settle and the chat-window
  // seam to mount with a uid + sessionId — that's what gates the chat
  // input being interactive. We do NOT wait for a kickoff bubble: the
  // agent may or may not auto-greet (depends on practices state), and
  // the spec is about the content of the turns we send, not the
  // unsolicited kickoff.
  await expect(page.locator('[data-testid="chat-window-state"][data-uid]')).toBeAttached();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="chat-window-state"]');
      return (el?.getAttribute('data-session-id') ?? '') !== '';
    },
    null,
    { timeout: 15_000 },
  );

  const transcript = await runConversation(page, TURNS);

  const verdict = await judgeTranscript(transcript);

  // Build a single failure message that includes every flagged turn so
  // CI logs are self-contained — no need to fish in the trace viewer.
  const failures = verdict.perTurn.filter((t) => !t.pass);
  if (failures.length > 0) {
    const detail = failures
      .map((f) => {
        const t = transcript[f.turn - 1];
        return [
          `Turn ${f.turn}: FAIL — ${f.reason}`,
          `  user:      ${t?.user ?? ''}`,
          `  assistant: ${t?.assistant ?? ''}`,
        ].join('\n');
      })
      .join('\n\n');
    throw new Error(
      `LLM judge flagged ${failures.length}/${transcript.length} turn(s):\n\n${detail}`,
    );
  }

  expect(verdict.pass).toBe(true);
});
