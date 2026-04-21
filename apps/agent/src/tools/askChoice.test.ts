import { describe, expect, it } from 'vitest';
import { createAskMultipleChoiceTool, createAskSingleChoiceTool } from './askChoice.js';

function exec(tool: ReturnType<typeof createAskSingleChoiceTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK tool internals
  return (tool as any).execute(input);
}

describe('ask_single_choice_question', () => {
  it('is named correctly and advertises "no additional text this turn"', () => {
    const tool = createAskSingleChoiceTool();
    expect(tool.name).toBe('ask_single_choice_question');
    expect(tool.description.toLowerCase()).toContain('no additional text');
  });

  it('returns a structured single-choice shown payload', async () => {
    const res = await exec(createAskSingleChoiceTool(), {
      question: 'How was your run?',
      options: ['Great', 'Okay', 'Struggled'],
    });
    expect(res).toEqual({
      status: 'shown',
      kind: 'single',
      question: 'How was your run?',
      options: ['Great', 'Okay', 'Struggled'],
    });
  });
});

describe('ask_multiple_choice_question', () => {
  it('returns kind: multiple', async () => {
    const res = await exec(createAskMultipleChoiceTool(), {
      question: 'Which apply?',
      options: ['A', 'B', 'C'],
    });
    expect(res).toMatchObject({ kind: 'multiple' });
  });
});
