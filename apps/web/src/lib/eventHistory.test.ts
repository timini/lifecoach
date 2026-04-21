import { describe, expect, it } from 'vitest';
import { eventsToMessages } from './eventHistory';

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

  it('skips tool-call events (internal, user never saw them)', () => {
    const msgs = eventsToMessages([
      {
        id: 'e1',
        author: 'lifecoach',
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'update_user_profile', args: {} } }],
        },
      },
      {
        id: 'e2',
        author: 'lifecoach',
        content: { role: 'model', parts: [{ text: 'got it' }] },
      },
    ]);
    expect(msgs).toHaveLength(1);
    if (msgs[0]?.role !== 'assistant') throw new Error();
    expect(msgs[0].elements).toEqual([{ kind: 'text', text: 'got it' }]);
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
