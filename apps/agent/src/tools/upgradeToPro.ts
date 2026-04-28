import { FunctionTool } from '@google/adk';
import { z } from 'zod';

/**
 * upgrade_to_pro — UI-directive tool. Mirrors connect_workspace / auth_user.
 *
 * The LLM emits this when a heavy free user could plausibly benefit from
 * Pro (more depth, faster replies, no daily nudges). The tool response is
 * a pure UI signal the web picks up via SSE; the browser renders an
 * UpgradePrompt card. Real billing isn't wired yet — for this phase the
 * card just collects interest.
 *
 * IMPORTANT: like connect_workspace, the LLM is never involved in payment.
 * This tool has no args, returns no billing values, and must not see any
 * customer/subscription/price IDs. Same auth-plane boundary.
 */
export const UPGRADE_TO_PRO_TOOL_NAME = 'upgrade_to_pro';

export function createUpgradeToProTool(): FunctionTool {
  const parameters = z.object({});

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: UPGRADE_TO_PRO_TOOL_NAME,
    description:
      'Surface a Lifecoach Pro upgrade card to the user. Use sparingly — at most once per ' +
      'session, and only when the conversation has just hit a moment where Pro would genuinely ' +
      'help (deeper analysis, faster replies, no daily nudges). After calling, write NO ' +
      'additional text that turn — the upgrade card is the entire response. Do NOT attempt to ' +
      'handle any payment values yourself; the application handles billing if and when the user ' +
      'opts in.',
    parameters,
    execute: async () => {
      return {
        status: 'upgrade_prompted' as const,
      };
    },
  });
}
