import { type Page, expect, test } from '@playwright/test';
import { sendChat } from './fixtures';
import { type JudgeTurn, judgeTranscript } from './judge';

/**
 * Chat-quality e2e: drive a 3-turn conversation through the deployed
 * web UI, capture each assistant reply, and ask Gemini (Vertex) to
 * judge whether each turn is substantive.
 *
 * Why this exists: `chat-persistence.spec.ts` only checks that *some*
 * assistant bubble appears; it would happily pass on the silent-turn
 * regressions we keep shipping and on /chat 500s where the user
 * message persists but no agent reply lands. This spec asserts the
 * content of each turn, not just presence.
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

// Selector matches both plain text bubbles and choice / auth / workspace
// prompt cards. A turn that ends in a `choice` element (e.g. agent calls
// `ask_single_choice_question`) is still a valid substantive response —
// it's just not a text bubble.
const ASSISTANT_CONTENT_SEL =
  '[data-from="assistant"], [data-testid="choice-prompt"], [data-testid="auth-prompt"], [data-testid="workspace-prompt"]';

async function runConversation(page: Page, turns: string[]): Promise<JudgeTurn[]> {
  const transcript: JudgeTurn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const userMsg = turns[i];
    const beforeCount = await page.locator(ASSISTANT_CONTENT_SEL).count();
    await sendChat(page, userMsg);

    // Wait for BOTH `data-busy="false"` AND a new piece of assistant
    // content (text bubble or choice/auth/workspace prompt). The /chat
    // SSE on Cloud Run can take >30s end-to-end (cold instance + LLM
    // tokens + stream flushing through GFE). 60s is comfortably above
    // the observed worst case.
    let assistant = '<NO ASSISTANT REPLY>';
    let atStreamEnd: string[] = [];
    try {
      await page.waitForFunction(
        ([sel, prev]) => {
          const ws = document.querySelector('[data-testid="chat-window-state"]');
          const busy = ws?.getAttribute('data-busy');
          if (busy !== 'false') return false;
          return document.querySelectorAll(sel).length > prev;
        },
        [ASSISTANT_CONTENT_SEL, beforeCount] as const,
        { timeout: 60_000 },
      );
      const after = await page.locator(ASSISTANT_CONTENT_SEL).allTextContents();
      const newOnes = after
        .slice(beforeCount)
        .map((s) => s.trim())
        .filter(Boolean);
      if (newOnes.length > 0) assistant = newOnes.join('\n');
      atStreamEnd = newOnes;
    } catch {
      // Timed out — dump what's actually on screen so a CI reader can
      // tell whether the agent went silent vs the FE just hadn't
      // rendered yet.
      const snapshot = await page.evaluate(() => {
        const out: string[] = [];
        const userBubbles = document.querySelectorAll('[data-from="user"]');
        out.push(`user-bubbles=${userBubbles.length}`);
        userBubbles.forEach((el, idx) => out.push(`  [${idx}] ${el.textContent?.slice(0, 80)}`));
        const asstBubbles = document.querySelectorAll('[data-from="assistant"]');
        out.push(`assistant-bubbles=${asstBubbles.length}`);
        asstBubbles.forEach((el, idx) => out.push(`  [${idx}] ${el.textContent?.slice(0, 200)}`));
        const choices = document.querySelectorAll('[data-testid="choice-prompt"]');
        out.push(`choice-prompts=${choices.length}`);
        choices.forEach((el, idx) => out.push(`  [${idx}] ${el.textContent?.slice(0, 200)}`));
        const ws = document.querySelector('[data-testid="chat-window-state"]');
        out.push(
          `chat-window-state busy=${ws?.getAttribute('data-busy')} sid=${ws?.getAttribute('data-session-id')?.slice(0, 30)} uid=${ws?.getAttribute('data-uid')?.slice(0, 8)}`,
        );
        return out.join('\n');
      });
      // eslint-disable-next-line no-console
      console.log(`[chat-quality][turn-${i + 1}] page snapshot:\n${snapshot}\n---`);
    }

    // Post-stream stability check — guards against the "flash then
    // disappear" class of regression where the assistant reply renders
    // during streaming, then a load-effect re-fire (e.g. on Firebase
    // token refresh flipping the User reference) calls setMessages([])
    // and the /history refetch races the agent's Firestore commit.
    // Only runs when the stream succeeded with non-empty content — if
    // we never saw a reply, the timeout/silent-turn path already failed
    // upstream (no point asserting persistence of nothing).
    if (atStreamEnd.length > 0) {
      await page.waitForTimeout(2_000);
      const stillThere = await page.locator(ASSISTANT_CONTENT_SEL).allTextContents();
      const stillNonEmpty = stillThere
        .slice(beforeCount)
        .map((s) => s.trim())
        .filter(Boolean);
      expect(
        stillNonEmpty.length,
        `Assistant content disappeared between stream-end and T+2s on turn ${i + 1}. ` +
          `at-stream-end=${JSON.stringify(atStreamEnd)} ; at-T+2s=${JSON.stringify(stillNonEmpty)}`,
      ).toBeGreaterThan(0);
    }

    transcript.push({ user: userMsg, assistant });
    // Surface in the test log so a reader of CI output can see what the
    // agent said even when the judge passes.
    // eslint-disable-next-line no-console
    console.log(`[chat-quality] user: ${userMsg}\n[chat-quality] assistant: ${assistant}\n---`);
  }
  return transcript;
}

test('three-turn conversation produces substantive replies (LLM judged)', async ({ page }) => {
  await page.goto('/chat');

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
