import { FunctionTool } from '@google/adk';
import { z } from 'zod';

/**
 * connect_workspace — UI-directive tool (no auth handling, no Google calls).
 *
 * The LLM emits this when the user is Google-linked but not yet Workspace-
 * connected and the conversation would benefit from workspace capability
 * (checking calendar, triaging email, managing tasks). The tool response is
 * a pure UI signal the web picks up via SSE; the browser then drives the
 * GIS `initCodeClient` popup, POSTs the code to the application, and the
 * *application* exchanges and stores tokens.
 *
 * IMPORTANT: the LLM is **never** involved in auth. This tool has no args,
 * returns no auth values, and must not see any codes/tokens. Matches the
 * auth_user pattern.
 */
export const CONNECT_WORKSPACE_TOOL_NAME = 'connect_workspace';

export function createConnectWorkspaceTool(): FunctionTool {
  const parameters = z.object({});

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: CONNECT_WORKSPACE_TOOL_NAME,
    description:
      'Prompt the user to grant Google Workspace access (Gmail, Calendar, Tasks) so you can ' +
      'read/send email, manage calendar, and manage tasks on their behalf. Use when their goal ' +
      'needs workspace capability and they have not yet granted it. After calling, write NO ' +
      'additional text that turn — the connect prompt is the entire response. Do NOT attempt to ' +
      'handle any tokens, codes, or secrets yourself; the application handles the OAuth flow.',
    parameters,
    execute: async () => {
      return {
        status: 'oauth_prompted' as const,
      };
    },
  });
}
