import { describe, expect, it } from 'vitest';
import { labelForToolCall, parseSseAssistant, parseSseAssistantText, parseSseBlock } from './sse';

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

  it('does not emit tool-call elements (those are streaming-only)', () => {
    const fc = {
      author: 'lifecoach',
      content: {
        parts: [
          {
            functionCall: {
              id: 'tc-1',
              name: 'call_workspace',
              args: { service: 'gmail', resource: 'messages', method: 'list' },
            },
          },
        ],
      },
    };
    const fr = {
      author: 'lifecoach',
      content: {
        parts: [
          {
            functionResponse: {
              id: 'tc-1',
              name: 'call_workspace',
              response: { status: 'ok', body: {} },
            },
          },
        ],
      },
    };
    const raw = `data: ${JSON.stringify(fc)}\n\ndata: ${JSON.stringify(fr)}\n\n`;
    // parseSseAssistant is used for history rehydration — should ignore
    // tool-call events entirely so replays aren't cluttered with badges.
    expect(parseSseAssistant(raw)).toEqual([]);
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

describe('parseSseBlock (streaming reducer)', () => {
  function blockFor(event: unknown): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  it('emits append-text ops for lifecoach text chunks', () => {
    const ops = parseSseBlock(
      blockFor({ author: 'lifecoach', content: { parts: [{ text: 'hello ' }] } }),
    );
    expect(ops).toEqual([{ op: 'append-text', text: 'hello ' }]);
  });

  it('pushes a tool-call element on functionCall, then finishes it on functionResponse (ok)', () => {
    const fcOps = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionCall: {
                id: 'tc-1',
                name: 'call_workspace',
                args: { service: 'gmail', resource: 'messages', method: 'list' },
              },
            },
          ],
        },
      }),
    );
    expect(fcOps).toHaveLength(1);
    expect(fcOps[0]).toMatchObject({
      op: 'push',
      element: { kind: 'tool-call', id: 'tc-1', name: 'call_workspace', done: false },
    });
    const el = (fcOps[0] as { element: { label: string } }).element;
    expect(el.label).toContain('gmail');

    const frOps = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'tc-1',
                name: 'call_workspace',
                response: { status: 'ok', body: {} },
              },
            },
          ],
        },
      }),
    );
    expect(frOps).toContainEqual({ op: 'finish-tool-call', id: 'tc-1', ok: true });
  });

  it('marks the tool-call failed when the response has an error code', () => {
    const frOps = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'tc-err',
                name: 'call_workspace',
                response: { status: 'error', code: 'upstream', message: 'quota' },
              },
            },
          ],
        },
      }),
    );
    expect(frOps).toContainEqual({ op: 'finish-tool-call', id: 'tc-err', ok: false });
  });

  it('ignores empty or non-data blocks', () => {
    expect(parseSseBlock('')).toEqual([]);
    expect(parseSseBlock('event: done\ndata: {}')).toEqual([]);
    expect(parseSseBlock('data: not-json')).toEqual([]);
  });
});

describe('labelForToolCall', () => {
  it('describes call_workspace by service + resource.method', () => {
    expect(
      labelForToolCall('call_workspace', {
        service: 'gmail',
        resource: 'messages',
        method: 'list',
      }),
    ).toContain('gmail');
    expect(
      labelForToolCall('call_workspace', {
        service: 'calendar',
        resource: 'events',
        method: 'insert',
      }),
    ).toContain('creating');
    expect(
      labelForToolCall('call_workspace', {
        service: 'tasks',
        resource: 'tasks',
        method: 'delete',
      }),
    ).toContain('removing');
  });

  it('has friendly labels for the other common tools', () => {
    expect(labelForToolCall('update_user_profile', { path: 'name', value: 'Tim' })).toContain(
      'remembering',
    );
    expect(labelForToolCall('log_goal_update', { goal: 'half marathon' })).toContain('goal');
    expect(labelForToolCall('auth_user', { mode: 'google' })).toContain('sign-in');
    expect(labelForToolCall('connect_workspace', {})).toContain('workspace');
  });

  it('falls back to `using <name>` for unknown tools', () => {
    expect(labelForToolCall('something_new', {})).toBe('using something_new');
  });
});
