import { describe, expect, it } from 'vitest';
import { CHOICE_TOOL_NAMES, ChoiceQuestionSchema } from './choiceQuestion.js';

describe('ChoiceQuestionSchema', () => {
  it('parses 2–8 option questions', () => {
    const parsed = ChoiceQuestionSchema.parse({
      question: 'How are you?',
      options: ['good', 'meh'],
    });
    expect(parsed.options).toHaveLength(2);
  });

  it('rejects fewer than 2 options', () => {
    expect(() => ChoiceQuestionSchema.parse({ question: 'q', options: ['only one'] })).toThrow();
  });

  it('rejects more than 8 options', () => {
    expect(() =>
      ChoiceQuestionSchema.parse({
        question: 'q',
        options: Array.from({ length: 9 }, (_, i) => `o${i}`),
      }),
    ).toThrow();
  });

  it('rejects empty strings in options', () => {
    expect(() => ChoiceQuestionSchema.parse({ question: 'q', options: ['ok', ''] })).toThrow();
  });

  it('rejects unknown top-level keys', () => {
    expect(() =>
      ChoiceQuestionSchema.parse({ question: 'q', options: ['a', 'b'], extra: true }),
    ).toThrow();
  });

  it('exposes the canonical tool names', () => {
    expect(CHOICE_TOOL_NAMES.single).toBe('ask_single_choice_question');
    expect(CHOICE_TOOL_NAMES.multiple).toBe('ask_multiple_choice_question');
  });
});
