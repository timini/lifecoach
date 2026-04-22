import { z } from 'zod';

/**
 * The Google Workspace OAuth scopes we request in one consent popup. Full
 * access on purpose — a personal-assistant app is crippled by read-only.
 * The `/settings` copy is the place where we explain to users what the
 * assistant can do with these in plain English.
 */
export const WORKSPACE_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
] as const;

export type WorkspaceScope = (typeof WORKSPACE_SCOPES)[number];

/**
 * Status returned by GET /workspace/status — never includes any token values.
 * The LLM never sees this (it's a web-UI concern), but we use the same schema
 * across the proxy boundary so the web + agent agree on the shape.
 */
export const WorkspaceStatusSchema = z
  .object({
    connected: z.boolean(),
    scopes: z.array(z.string()),
    grantedAt: z.string().datetime().nullable(),
  })
  .strict();

export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;
