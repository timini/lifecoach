import { FunctionTool } from '@google/adk';
import { CHOICE_TOOL_NAMES } from '@lifecoach/shared-types';
import { z } from 'zod';

/**
 * Choice tools don't "do" anything — calling them surfaces a structured
 * UI directive in the tool-response event that the web parses and renders
 * as an inline radio (single) or checkbox (multiple) widget. The user's
 * selection comes back as a normal chat message on the next turn.
 *
 * We still return a short status string so the model has a clear signal
 * that the tool "succeeded" and it shouldn't produce any follow-up text
 * in the same turn.
 */

const parametersShape = z.object({
  question: z.string().min(1).describe('The question to show to the user.'),
  options: z.array(z.string().min(1)).min(2).max(8).describe('2–8 short answer options.'),
});

const SINGLE_DESC =
  'Ask the user a single-choice question. Renders as radio buttons in the chat. ' +
  'Prefer this over open-ended questions whenever the answer space is 2–8 options. ' +
  'After calling this tool, write NO additional text this turn — wait for the user to pick.';

const MULTIPLE_DESC =
  'Ask the user a multiple-choice question (can pick multiple). Renders as checkboxes. ' +
  'Use when multiple answers make sense (e.g., "which of these apply to you?"). ' +
  'After calling this tool, write NO additional text this turn — wait for the user to pick.';

export function createAskSingleChoiceTool(): FunctionTool {
  // biome-ignore lint/suspicious/noExplicitAny: zod generic mismatch with ADK
  return new FunctionTool<any>({
    name: CHOICE_TOOL_NAMES.single,
    description: SINGLE_DESC,
    parameters: parametersShape,
    execute: async (input: unknown) => {
      const { question, options } = input as { question: string; options: string[] };
      return { status: 'shown' as const, kind: 'single' as const, question, options };
    },
  });
}

export function createAskMultipleChoiceTool(): FunctionTool {
  // biome-ignore lint/suspicious/noExplicitAny: zod generic mismatch with ADK
  return new FunctionTool<any>({
    name: CHOICE_TOOL_NAMES.multiple,
    description: MULTIPLE_DESC,
    parameters: parametersShape,
    execute: async (input: unknown) => {
      const { question, options } = input as { question: string; options: string[] };
      return { status: 'shown' as const, kind: 'multiple' as const, question, options };
    },
  });
}
