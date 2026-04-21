import { z } from 'zod';

/**
 * Shapes for the inline choice questions the agent can render via tool calls.
 * Both the agent tool (args) and the web renderer (SSE event payload) use
 * these schemas so they can never drift apart.
 */

export const ChoiceQuestionSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(8),
  })
  .strict();

export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;

export const CHOICE_TOOL_NAMES = {
  single: 'ask_single_choice_question',
  multiple: 'ask_multiple_choice_question',
} as const;

export type ChoiceToolName = (typeof CHOICE_TOOL_NAMES)[keyof typeof CHOICE_TOOL_NAMES];
