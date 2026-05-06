import { describe, expect, it } from 'vitest';
import { eventsToMessages, normaliseEventTimestamp } from './eventHistory';

describe('normaliseEventTimestamp', () => {
  it('converts seconds-epoch values to ms (heuristic: < 1e12 means seconds)', () => {
    // 1746540000 ≈ May 2026 in seconds; normalise should give the ms.
    expect(normaliseEventTimestamp(1746540000)).toBe(1746540000000);
  });

  it('passes through ms-epoch values untouched', () => {
    // 1746540000000 ≈ May 2026 in ms; should not be re-multiplied.
    expect(normaliseEventTimestamp(1746540000000)).toBe(1746540000000);
  });

  it('returns 0 for missing / non-finite / non-positive', () => {
    expect(normaliseEventTimestamp(undefined)).toBe(0);
    expect(normaliseEventTimestamp(0)).toBe(0);
    expect(normaliseEventTimestamp(-1)).toBe(0);
    expect(normaliseEventTimestamp(Number.NaN)).toBe(0);
    expect(normaliseEventTimestamp(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('floors fractional seconds (e.g. 1746540000.789 → 1746540000789 ms)', () => {
    expect(normaliseEventTimestamp(1746540000.789)).toBe(1746540000789);
  });
});

describe('eventsToMessages', () => {
  it('returns [] on empty input', () => {
    expect(eventsToMessages([])).toEqual([]);
  });

  it('produces a user message from an event with author=user', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'user',
        content: { role: 'user', parts: [{ text: 'hi' }] },
      },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'hi' });
  });

  it('produces an assistant message from author=lifecoach text events', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: { role: 'model', parts: [{ text: 'hey there' }] },
      },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'assistant' });
    if (msgs[0]?.role !== 'assistant') throw new Error();
    expect(msgs[0].elements).toEqual([{ kind: 'text', text: 'hey there' }]);
  });

  it('emits a tool-call pill for informational tools so they persist in history', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: {
          role: 'model',
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
      },
      {
        id: 'e2',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionResponse: {
                id: 'tc-1',
                name: 'call_workspace',
                response: { status: 'ok' },
              },
            },
          ],
        },
      },
      {
        id: 'e3',
        author: 'lifecoach',
        content: { role: 'model', parts: [{ text: 'got it' }] },
      },
    ]);
    expect(msgs).toHaveLength(2);
    if (msgs[0]?.role !== 'assistant') throw new Error();
    expect(msgs[0].elements).toHaveLength(1);
    expect(msgs[0].elements[0]).toMatchObject({
      kind: 'tool-call',
      id: 'tc-1',
      name: 'call_workspace',
      label: expect.stringContaining('gmail'),
      done: true,
      ok: true,
    });
    if (msgs[1]?.role !== 'assistant') throw new Error();
    expect(msgs[1].elements).toEqual([{ kind: 'text', text: 'got it' }]);
  });

  it('attaches args + response to the rehydrated tool-call element', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'tc-1',
                name: 'update_user_profile',
                args: { path: 'family.children[0].name', value: 'Wren' },
              },
            },
          ],
        },
      },
      {
        id: 'e2',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionResponse: {
                id: 'tc-1',
                name: 'update_user_profile',
                response: {
                  status: 'ok',
                  previous_value: null,
                  new_value: 'Wren',
                  modified_at: '2026-05-06T18:00:00Z',
                },
              },
            },
          ],
        },
      },
    ]);
    if (msgs[0]?.role !== 'assistant') throw new Error();
    const el = msgs[0].elements[0];
    if (!el || el.kind !== 'tool-call') throw new Error();
    expect(el.args).toEqual({ path: 'family.children[0].name', value: 'Wren' });
    expect(el.response).toMatchObject({
      previous_value: null,
      new_value: 'Wren',
      modified_at: '2026-05-06T18:00:00Z',
    });
  });

  it('marks the pill as failed when the matched response carries an error code', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'tc-err',
                name: 'call_workspace',
                args: { service: 'gmail', resource: 'messages', method: 'list' },
              },
            },
          ],
        },
      },
      {
        id: 'e2',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionResponse: {
                id: 'tc-err',
                name: 'call_workspace',
                response: { status: 'error', code: 'upstream' },
              },
            },
          ],
        },
      },
    ]);
    expect(msgs).toHaveLength(1);
    if (msgs[0]?.role !== 'assistant') throw new Error();
    expect(msgs[0].elements[0]).toMatchObject({ kind: 'tool-call', done: true, ok: false });
  });

  it('treats scope_required as ok (recoverable, not error-styled)', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 't1',
                name: 'call_workspace',
                args: { service: 'gmail', resource: 'messages', method: 'list' },
              },
            },
          ],
        },
      },
      {
        id: 'e2',
        author: 'lifecoach',
        content: {
          role: 'model',
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
      },
    ]);
    if (msgs[0]?.role !== 'assistant') throw new Error();
    expect(msgs[0].elements[0]).toMatchObject({ kind: 'tool-call', ok: true });
  });

  it('drops UI-directive tool calls (their widgets were already user-visible live)', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'p1',
                name: 'ask_single_choice_question',
                args: { question: 'q', options: ['a', 'b'] },
              },
            },
          ],
        },
      },
      {
        id: 'e2',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'w1',
                name: 'connect_workspace',
                args: {},
              },
            },
          ],
        },
      },
      {
        id: 'e3',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: { id: 'a1', name: 'auth_user', args: { mode: 'google' } },
            },
          ],
        },
      },
      {
        id: 'e4',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: { id: 'u1', name: 'upgrade_to_pro', args: {} },
            },
          ],
        },
      },
    ]);
    expect(msgs).toEqual([]);
  });

  it('strips choice-tool responses from history (picker is turn-scoped)', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [
            {
              functionResponse: {
                name: 'ask_single_choice_question',
                response: { status: 'shown', question: 'q', options: ['a', 'b'] },
              },
            },
          ],
        },
      },
    ]);
    expect(msgs).toEqual([]);
  });

  it('merges consecutive text parts on the same event into one message', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: { role: 'model', parts: [{ text: 'hi ' }, { text: 'there' }] },
      },
    ]);
    expect(msgs).toHaveLength(1);
    if (msgs[0]?.role !== 'assistant') throw new Error();
    expect(msgs[0].elements).toEqual([{ kind: 'text', text: 'hi there' }]);
  });

  it('synthesises an id when the event is missing one', () => {
    const msgs = eventsToMessages([
      { author: 'user', content: { role: 'user', parts: [{ text: 'hi' }] } },
    ]);
    expect(msgs[0]?.id).toMatch(/^h-/);
  });

  it('drops the __session_start__ kickoff sentinel from rehydrated history', () => {
    const msgs = eventsToMessages([
      {
        id: 'k1',
        author: 'user',
        content: { role: 'user', parts: [{ text: '__session_start__' }] },
      },
      {
        id: 'a1',
        author: 'lifecoach',
        content: { role: 'model', parts: [{ text: 'morning!' }] },
      },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'assistant' });
  });

  it('drops the __continue__ retry sentinel from rehydrated history', () => {
    const msgs = eventsToMessages([
      { id: 'u1', author: 'user', content: { role: 'user', parts: [{ text: 'hi' }] } },
      // First model turn was empty (no text); the retry sentinel + the
      // model's real reply land in history. The user should see only
      // their own "hi" + the recovered reply, not the plumbing.
      {
        id: 'k1',
        author: 'user',
        content: { role: 'user', parts: [{ text: '__continue__' }] },
      },
      {
        id: 'a1',
        author: 'lifecoach',
        content: { role: 'model', parts: [{ text: 'hey, how are you doing today?' }] },
      },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'hi' });
    expect(msgs[1]).toMatchObject({ role: 'assistant' });
  });

  it('preserves order and handles a mixed transcript', () => {
    const msgs = eventsToMessages([
      { id: 'u1', author: 'user', content: { role: 'user', parts: [{ text: 'hey' }] } },
      {
        id: 'a1',
        author: 'lifecoach',
        content: { role: 'model', parts: [{ text: 'hi back' }] },
      },
      { id: 'u2', author: 'user', content: { role: 'user', parts: [{ text: 'ok' }] } },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
