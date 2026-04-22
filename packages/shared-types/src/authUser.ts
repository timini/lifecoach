import { z } from 'zod';

/**
 * auth_user tool args. The agent calls this when it wants to invite the
 * user to upgrade from anonymous sign-in to an email or Google account —
 * typically after a handful of meaningful turns and only from the
 * `anonymous` user state.
 */

export const AUTH_MODES = ['google', 'email'] as const;

export const AuthUserArgsSchema = z
  .object({
    mode: z.enum(AUTH_MODES),
    // Only required for mode: 'email' — the model either prompts the user
    // to type it on the frontend, or passes through what the user already
    // said. Empty = frontend asks.
    email: z.string().email().optional(),
  })
  .strict();

export type AuthMode = (typeof AUTH_MODES)[number];
export type AuthUserArgs = z.infer<typeof AuthUserArgsSchema>;

export const AUTH_USER_TOOL_NAME = 'auth_user';
