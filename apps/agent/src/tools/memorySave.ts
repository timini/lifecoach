import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { MemoryClient } from '../context/memory.js';

/**
 * Tool: memory_save — persist a bit of long-term context about the user to
 * mem0. Closed over uid. The memory search on every turn is done
 * server-side (see buildInstruction / server.ts), NOT via a tool call —
 * so there's no corresponding memory_search tool and the coach never has
 * to say "let me check my memory."
 */
export function createMemorySaveTool(deps: {
  client: MemoryClient;
  uid: string;
}): FunctionTool {
  const parameters = z.object({
    text: z
      .string()
      .min(5)
      .describe(
        'A self-contained factual statement about the user, written in the ' +
          'third person. Example: "User is training for a half-marathon and ' +
          'had a calf strain in April 2026."',
      ),
  });

  // biome-ignore lint/suspicious/noExplicitAny: zod instance nominal mismatch with ADK
  return new FunctionTool<any>({
    name: 'memory_save',
    description:
      'Save a long-term narrative memory — the kind of context that does NOT fit ' +
      'a single profile slot but matters for future conversations. Call PROACTIVELY ' +
      'when you learn: ' +
      '(a) relational context about people in their life ("Wren is doing well at ' +
      'violin and enjoys it", "co-founder Alex is going through a divorce"); ' +
      '(b) ongoing projects, training plans, or goals with detail too rich for ' +
      'a path ("training for half-marathon, calf strain in April, comfortable at 6.5k"); ' +
      '(c) life circumstances, health context, work situation that affects coaching; ' +
      "(d) recurring people you've met before resurfacing in conversation. " +
      'Often pairs with update_user_profile (one captures the slot, the other the ' +
      'narrative) — call both when both apply. Write in third-person, self-contained ' +
      'so a future session reads it standalone ("Tim\'s daughter Wren, age 8, plays ' +
      'violin and enjoys it"). NEVER announce ("let me remember that") — save ' +
      'silently and continue the conversation.',
    parameters,
    execute: async (input: unknown) => {
      const { text } = input as { text: string };
      try {
        await deps.client.save(deps.uid, text);
        return { status: 'ok' as const };
      } catch (err) {
        return {
          status: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
