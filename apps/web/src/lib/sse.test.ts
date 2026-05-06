import { describe, expect, it } from 'vitest';
import { labelForToolCall, parseSseAssistant, parseSseAssistantText, parseSseBlock } from './sse';

describe('parseSseAssistantText', () => {
  it('returns the last assistant text from a single delta event', () => {
    const raw =
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"hello"}]}}\n\n';
    expect(parseSseAssistantText(raw)).toBe('hello');
  });

  it('concatenates text parts across multiple delta events', () => {
    const raw =
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"hi "}]}}\n\n' +
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"there"}]}}\n\n' +
      'event: done\ndata: {}\n\n';
    expect(parseSseAssistantText(raw)).toBe('hi there');
  });

  it('ignores non-data lines and bare control events', () => {
    const raw =
      ': comment\n' +
      'event: done\ndata: {}\n\n' +
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"ok"}]}}\n\n';
    expect(parseSseAssistantText(raw)).toBe('ok');
  });

  it('returns empty string on garbage input', () => {
    expect(parseSseAssistantText('')).toBe('');
    expect(parseSseAssistantText('data: not-json\n\n')).toBe('');
  });

  it('ignores events from non-lifecoach authors (e.g., user echo)', () => {
    const raw =
      'data: {"author":"user","partial":true,"content":{"parts":[{"text":"hi"}]}}\n\n' +
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"hey"}]}}\n\n';
    expect(parseSseAssistantText(raw)).toBe('hey');
  });

  it('skips the trailing aggregate (partial undefined) so text is not doubled', () => {
    // ADK in StreamingMode.SSE emits N partial=true delta events plus a
    // trailing event with `partial` UNDEFINED (not false) that re-carries
    // the full concatenated text — sometimes with trailing
    // `emergent_ui:` metadata Gemini bakes in. The parser must keep the
    // deltas and drop the aggregate, otherwise the user sees the reply
    // twice with metadata leak.
    const raw =
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"hi "}]}}\n\n' +
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"there"}]}}\n\n' +
      'data: {"author":"lifecoach","content":{"parts":[{"text":"hi there emergent_ui: none"}]}}\n\n' +
      'event: done\ndata: {}\n\n';
    expect(parseSseAssistantText(raw)).toBe('hi there');
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
      partial: true,
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

  it('emits append-text ops for partial lifecoach text deltas', () => {
    const ops = parseSseBlock(
      blockFor({ author: 'lifecoach', partial: true, content: { parts: [{ text: 'hello ' }] } }),
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
    expect(frOps).toContainEqual(
      expect.objectContaining({ op: 'finish-tool-call', id: 'tc-1', ok: true }),
    );
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
    expect(frOps).toContainEqual(
      expect.objectContaining({ op: 'finish-tool-call', id: 'tc-err', ok: false }),
    );
  });

  it('ignores empty or non-data blocks', () => {
    expect(parseSseBlock('')).toEqual([]);
    expect(parseSseBlock('event: done\ndata: {}')).toEqual([]);
    expect(parseSseBlock('data: not-json')).toEqual([]);
  });

  it('drops text from the trailing aggregate event (partial undefined)', () => {
    // ADK emits a trailing lifecoach event after the partial=true
    // deltas with `partial` left UNDEFINED that re-carries the full
    // text (and may carry trailing `emergent_ui: none` meta from
    // Gemini). Keeping it would double the visible text.
    const ops = parseSseBlock(
      'data: {"author":"lifecoach","content":{"parts":[{"text":"hello there emergent_ui: none"}]}}',
    );
    expect(ops).toEqual([]);
  });

  it('also drops text when partial is explicitly false', () => {
    // Defensive: ADK may flag the aggregate as partial:false in some
    // builds. Either way, only partial:true is allowed to append text.
    const ops = parseSseBlock(
      'data: {"author":"lifecoach","partial":false,"content":{"parts":[{"text":"hello"}]}}',
    );
    expect(ops).toEqual([]);
  });

  it('still appends text from partial=true delta events', () => {
    const ops = parseSseBlock(
      'data: {"author":"lifecoach","partial":true,"content":{"parts":[{"text":"hello"}]}}',
    );
    expect(ops).toEqual([{ op: 'append-text', text: 'hello' }]);
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
    expect(labelForToolCall('update_user_profile', { path: 'name', value: 'Alex' })).toContain(
      'remembering',
    );
    expect(labelForToolCall('log_goal_update', { goal: 'half marathon' })).toContain('goal');
    expect(labelForToolCall('auth_user', { mode: 'google' })).toContain('sign-in');
    expect(labelForToolCall('connect_workspace', {})).toContain('workspace');
    expect(labelForToolCall('upgrade_to_pro', {})).toMatch(/pro/i);
  });

  it('falls back to `using <name>` for unknown tools', () => {
    expect(labelForToolCall('something_new', {})).toBe('using something_new');
  });

  it('covers every tool-name branch', () => {
    expect(labelForToolCall('ask_single_choice_question', {})).toBe('showing a choice');
    expect(labelForToolCall('ask_multiple_choice_question', {})).toBe('showing a choice');
    expect(labelForToolCall('memory_save', {})).toBe('saving memory');
    expect(labelForToolCall('memory_search', {})).toBe('recalling');
    expect(labelForToolCall('google_search', {})).toBe('searching the web');
    expect(labelForToolCall('upgrade_to_pro', {})).toBe('offering pro upgrade');
  });

  it('covers update_user_profile + log_goal_update fallbacks when args are missing', () => {
    expect(labelForToolCall('update_user_profile', {})).toBe('remembering that');
    expect(labelForToolCall('log_goal_update', {})).toBe('logging goal');
  });

  it('covers every call_workspace method verb + service fallback', () => {
    expect(
      labelForToolCall('call_workspace', { service: 'gmail', resource: 'messages', method: 'get' }),
    ).toContain('reading');
    expect(
      labelForToolCall('call_workspace', {
        service: 'gmail',
        resource: 'messages',
        method: 'send',
      }),
    ).toContain('sending');
    expect(
      labelForToolCall('call_workspace', {
        service: 'calendar',
        resource: 'events',
        method: 'patch',
      }),
    ).toContain('updating');
    expect(
      labelForToolCall('call_workspace', {
        service: 'unknown-service',
        resource: 'x',
        method: 'weird',
      }),
    ).toContain('using workspace');
    // No args at all — still produces a sane label.
    expect(labelForToolCall('call_workspace', undefined)).toContain('workspace');
  });
});

describe('parseSseBlock — extra branches', () => {
  function blockFor(event: unknown): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  it('does not append empty text chunks', () => {
    const ops = parseSseBlock(
      blockFor({ author: 'lifecoach', content: { parts: [{ text: '' }] } }),
    );
    expect(ops).toEqual([]);
  });

  it('handles a functionCall with no id by falling back to name', () => {
    const ops = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: { parts: [{ functionCall: { name: 'log_goal_update', args: {} } }] },
      }),
    );
    expect(ops[0]).toMatchObject({
      op: 'push',
      element: { kind: 'tool-call', id: 'log_goal_update' },
    });
  });

  it('pushes an auth element from auth_user functionResponse', () => {
    const ops = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'a1',
                name: 'auth_user',
                response: { status: 'auth_prompted', mode: 'google' },
              },
            },
          ],
        },
      }),
    );
    expect(ops).toContainEqual(
      expect.objectContaining({
        op: 'push',
        element: expect.objectContaining({ kind: 'auth', mode: 'google' }),
      }),
    );
  });

  it('pushes a workspace element from connect_workspace functionResponse', () => {
    const ops = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'w1',
                name: 'connect_workspace',
                response: { status: 'oauth_prompted' },
              },
            },
          ],
        },
      }),
    );
    expect(ops).toContainEqual(
      expect.objectContaining({
        op: 'push',
        element: expect.objectContaining({ kind: 'workspace' }),
      }),
    );
  });

  it('pushes an upgrade element from upgrade_to_pro functionResponse', () => {
    const ops = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'u1',
                name: 'upgrade_to_pro',
                response: { status: 'upgrade_prompted' },
              },
            },
          ],
        },
      }),
    );
    expect(ops).toContainEqual(
      expect.objectContaining({
        op: 'push',
        element: expect.objectContaining({ kind: 'upgrade' }),
      }),
    );
  });

  it('pushes a choice element from ask_multiple_choice_question response', () => {
    const ops = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'c1',
                name: 'ask_multiple_choice_question',
                response: {
                  status: 'shown',
                  question: 'pick some',
                  options: ['a', 'b'],
                },
              },
            },
          ],
        },
      }),
    );
    expect(ops).toContainEqual({
      op: 'push',
      element: { kind: 'choice', single: false, question: 'pick some', options: ['a', 'b'] },
    });
  });

  it('treats scope_required responses as ok (so the pill is not error-styled)', () => {
    const ops = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 't1',
                name: 'call_workspace',
                response: { status: 'error', code: 'scope_required' },
              },
            },
          ],
        },
      }),
    );
    expect(ops).toContainEqual(
      expect.objectContaining({ op: 'finish-tool-call', id: 't1', ok: true }),
    );
  });
});
