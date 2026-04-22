import { FunctionTool } from '@google/adk';
import { AUTH_MODES, AUTH_USER_TOOL_NAME, type AuthMode } from '@lifecoach/shared-types';
import { z } from 'zod';

/**
 * auth_user — surfaces a sign-in UI directive to the frontend.
 *
 * Same pattern as the choice-tool family: the tool's job is to emit a
 * structured response the web picks up via SSE and renders as an
 * inline component. There's no server-side Firebase call — the actual
 * linkWithPopup / email-link call happens in the browser against the
 * Firebase Auth client SDK, which owns the anonymous UID.
 */
export function createAuthUserTool(): FunctionTool {
  const parameters = z.object({
    mode: z
      .enum(AUTH_MODES as unknown as [string, ...string[]])
      .describe('How to upgrade: "google" = one-click Google sign-in; "email" = email magic-link.'),
    email: z
      .string()
      .optional()
      .describe(
        'Only for mode="email". If you already know the user\'s email, pass it; otherwise omit and the UI will ask.',
      ),
  });

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: AUTH_USER_TOOL_NAME,
    description:
      'Invite the user to save their progress by signing in with Google or email. ' +
      'Use ONLY in the anonymous user state, after several meaningful turns, when the ' +
      'user has shared enough that losing it on device change would frustrate them. ' +
      'Do NOT call this on the first turn. After calling, write NO additional text that turn — ' +
      'the sign-in prompt is the entire response.',
    parameters,
    execute: async (input: unknown) => {
      const { mode, email } = input as { mode: AuthMode; email?: string };
      return {
        status: 'auth_prompted' as const,
        mode,
        ...(email ? { email } : {}),
      };
    },
  });
}
