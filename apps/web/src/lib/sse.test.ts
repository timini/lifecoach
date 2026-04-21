import { describe, expect, it } from 'vitest';
import { parseSseAssistant, parseSseAssistantText } from './sse';

describe('parseSseAssistantText', () => {
  it('returns the last assistant text from an SSE stream with one event', () => {
    const raw = 'data: {"author":"lifecoach","content":{"parts":[{"text":"hello"}]}}\n\n';
    expect(parseSseAssistantText(raw)).toBe('hello');
  });

  it('concatenates text parts across multiple events', () => {
    const raw =
      'data: {"author":"lifecoach","content":{"parts":[{"text":"hi "}]}}\n\n' +
      'data: {"author":"lifecoach","content":{"parts":[{"text":"there"}]}}\n\n' +
      'event: done\ndata: {}\n\n';
    expect(parseSseAssistantText(raw)).toBe('hi there');
  });

  it('ignores non-data lines and bare control events', () => {
    const raw =
      ': comment\n' +
      'event: done\ndata: {}\n\n' +
      'data: {"author":"lifecoach","content":{"parts":[{"text":"ok"}]}}\n\n';
    expect(parseSseAssistantText(raw)).toBe('ok');
  });

  it('returns empty string on garbage input', () => {
    expect(parseSseAssistantText('')).toBe('');
    expect(parseSseAssistantText('data: not-json\n\n')).toBe('');
  });

  it('ignores events from non-lifecoach authors (e.g., user echo)', () => {
    const raw =
      'data: {"author":"user","content":{"parts":[{"text":"hi"}]}}\n\n' +
      'data: {"author":"lifecoach","content":{"parts":[{"text":"hey"}]}}\n\n';
    expect(parseSseAssistantText(raw)).toBe('hey');
  });
});

describe('parseSseAssistant', () => {
  it('extracts a single-choice question from a tool response event', () => {
    const fr = {
      functionResponse: {
        name: 'ask_single_choice_question',
        response: {
          status: 'shown',
          kind: 'single',
          question: 'How was your run?',
          options: ['Great', 'Okay', 'Struggled'],
        },
      },
    };
    const raw = `data: ${JSON.stringify({
      author: 'lifecoach',
      content: { parts: [fr] },
    })}\n\n`;
    const elements = parseSseAssistant(raw);
    expect(elements).toEqual([
      {
        kind: 'choice',
        single: true,
        question: 'How was your run?',
        options: ['Great', 'Okay', 'Struggled'],
      },
    ]);
  });

  it('interleaves text then choice in emission order', () => {
    const text = {
      author: 'lifecoach',
      content: { parts: [{ text: 'quick question:' }] },
    };
    const choice = {
      author: 'lifecoach',
      content: {
        parts: [
          {
            functionResponse: {
              name: 'ask_multiple_choice_question',
              response: {
                status: 'shown',
                kind: 'multiple',
                question: 'which apply',
                options: ['a', 'b', 'c'],
              },
            },
          },
        ],
      },
    };
    const raw = `data: ${JSON.stringify(text)}\n\ndata: ${JSON.stringify(choice)}\n\n`;
    const elements = parseSseAssistant(raw);
    expect(elements).toHaveLength(2);
    expect(elements[0]).toEqual({ kind: 'text', text: 'quick question:' });
    expect(elements[1]).toMatchObject({ kind: 'choice', single: false });
  });
});
