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
              name: 'triage_inbox',
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
              name: 'triage_inbox',
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
        partial: true,
        content: {
          parts: [
            {
              functionCall: {
                id: 'tc-1',
                name: 'triage_inbox',
                args: {},
              },
            },
          ],
        },
      }),
    );
    expect(fcOps).toHaveLength(1);
    expect(fcOps[0]).toMatchObject({
      op: 'push',
      element: { kind: 'tool-call', id: 'tc-1', name: 'triage_inbox', done: false },
    });
    const el = (fcOps[0] as { element: { label: string } }).element;
    expect(el.label).toContain('inbox');

    const frOps = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'tc-1',
                name: 'triage_inbox',
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

  it('marks bridged workspace inner calls with parentId and strips bridge metadata', () => {
    const fcOps = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        partial: true,
        content: {
          parts: [
            {
              functionCall: {
                id: 'inner-1',
                name: 'list_inbox',
                args: { since: '1d', __parentToolCallId: 'outer-1', __workspaceInner: true },
              },
            },
          ],
        },
      }),
    );
    expect(fcOps[0]).toMatchObject({
      op: 'push',
      element: {
        kind: 'tool-call',
        id: 'inner-1',
        name: 'list_inbox',
        parentId: 'outer-1',
        args: { since: '1d' },
      },
    });

    const frOps = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        content: {
          parts: [
            {
              functionResponse: {
                id: 'inner-1',
                name: 'list_inbox',
                response: { status: 'ok', count: 2, __parentToolCallId: 'outer-1' },
              },
            },
          ],
        },
      }),
    );
    expect(frOps[0]).toMatchObject({
      op: 'finish-tool-call',
      id: 'inner-1',
      parentId: 'outer-1',
      response: { status: 'ok', count: 2 },
    });
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
                name: 'find_workspace',
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
  it('describes triage_inbox + find_workspace as user-facing reads', () => {
    expect(labelForToolCall('triage_inbox', {})).toContain('inbox');
    expect(labelForToolCall('find_workspace', { query: "Sarah's email last week" })).toContain(
      "Sarah's email",
    );
    // No query → still produces a sane label.
    expect(labelForToolCall('find_workspace', {})).toContain('workspace');
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

  it('describes the workspace write tools by their action', () => {
    expect(labelForToolCall('archive_messages', { ids: ['m1'] })).toContain('1 message');
    expect(labelForToolCall('archive_messages', { ids: ['m1', 'm2', 'm3'] })).toContain(
      '3 messages',
    );
    // No ids array yet (pending invocation) → still readable.
    expect(labelForToolCall('archive_messages', {})).toContain('messages');

    expect(
      labelForToolCall('add_calendar_event', {
        summary: 'Maya parent-teacher',
        start: '2026-05-12T18:00:00+01:00',
      }),
    ).toContain('Maya parent-teacher');
    expect(labelForToolCall('add_calendar_event', {})).toContain('calendar event');

    expect(labelForToolCall('add_task', { title: 'Reply to Sarah' })).toContain('Reply to Sarah');
    expect(labelForToolCall('add_task', {})).toContain('task');

    expect(labelForToolCall('complete_task', { id: 't1' })).toContain('done');
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
        partial: true,
        content: { parts: [{ functionCall: { name: 'log_goal_update', args: {} } }] },
      }),
    );
    expect(ops[0]).toMatchObject({
      op: 'push',
      element: { kind: 'tool-call', id: 'log_goal_update' },
    });
  });

  it('drops the trailing partial=false aggregate functionCall event (no duplicate badge)', () => {
    // Python ADK emits the function_call in BOTH a streaming
    // partial:true event AND a trailing partial:false aggregate that
    // re-carries the same call. Without dedup the FE renders two
    // tool-call badges with the same id — visible in the UI as
    // "showing a choice · showing a choice" before each turn that
    // calls a tool. We rely on the partial=true gate to drop the
    // aggregate.
    const streaming = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        partial: true,
        content: {
          parts: [{ functionCall: { id: 'tc-9', name: 'log_goal_update', args: { goal: 'x' } } }],
        },
      }),
    );
    const aggregate = parseSseBlock(
      blockFor({
        author: 'lifecoach',
        partial: false,
        content: {
          parts: [
            { functionCall: { id: 'tc-9', name: 'log_goal_update', args: { goal: 'x' } } },
            { text: '' },
          ],
        },
      }),
    );
    expect(streaming).toHaveLength(1);
    expect(streaming[0]).toMatchObject({
      op: 'push',
      element: { kind: 'tool-call', id: 'tc-9' },
    });
    expect(aggregate).toEqual([]);
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
                name: 'triage_inbox',
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
