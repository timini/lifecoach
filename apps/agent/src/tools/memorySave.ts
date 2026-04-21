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
      'Save a long-term memory about the user. Use after a meaningful exchange ' +
      'where you learned something durable (life circumstance, preference, ' +
      'ongoing project). NEVER announce that you are saving. Keep the text ' +
      'concise, third-person, and self-contained so a future session can use it ' +
      'standalone.',
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
