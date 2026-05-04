import type { Event } from '@google/adk';
import { describe, expect, it } from 'vitest';
import {
  findEmptyTurnGaps,
  injectRecoveryEvents,
  makeRecoveryEvent,
  pickRecoveryText,
} from './emptyTurnGuard.js';

function userText(text: string): Event {
  return {
    author: 'user',
    content: { role: 'user', parts: [{ text }] },
  } as unknown as Event;
}

function modelText(text: string): Event {
  return {
    author: 'lifecoach',
    content: { role: 'model', parts: [{ text }] },
  } as unknown as Event;
}

function modelCall(name: string): Event {
  return {
    author: 'lifecoach',
    content: { role: 'model', parts: [{ functionCall: { name, args: {} } }] },
  } as unknown as Event;
}

function toolResponse(name: string): Event {
  return {
    author: 'user',
    content: { role: 'user', parts: [{ functionResponse: { name, response: { status: 'ok' } } }] },
  } as unknown as Event;
}

describe('pickRecoveryText', () => {
  it('returns the generic copy when no tools fired', () => {
    expect(pickRecoveryText([])).toBe('Done. What next?');
  });

  it('acknowledges saves when only write tools fired', () => {
    expect(pickRecoveryText([{ name: 'update_user_profile' }])).toBe('Got it — saved.');
    expect(pickRecoveryText([{ name: 'log_goal_update' }, { name: 'memory_save' }])).toBe(
      'Got it — saved.',
    );
  });

  it('invites a follow-up when only read tools fired', () => {
    expect(pickRecoveryText([{ name: 'call_workspace' }])).toBe(
      'All set — anything jump out, or want me to dig in?',
    );
    expect(pickRecoveryText([{ name: 'google_search' }])).toBe(
      'All set — anything jump out, or want me to dig in?',
    );
  });

  it('falls back to the generic copy when reads and writes mix', () => {
    expect(pickRecoveryText([{ name: 'call_workspace' }, { name: 'update_user_profile' }])).toBe(
      'Done. What next?',
    );
  });

  it('falls back to the generic copy for unknown tools', () => {
    expect(pickRecoveryText([{ name: 'something_else' }])).toBe('Done. What next?');
  });
});

describe('findEmptyTurnGaps', () => {
  it('finds nothing on a healthy conversation with no tools', () => {
    const events = [userText('hi'), modelText('hello back')];
    expect(findEmptyTurnGaps(events)).toEqual([]);
  });

  it('finds nothing when a tool call is followed by model text', () => {
    const events = [
      userText('search emails'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      modelText("here's what I found"),
    ];
    expect(findEmptyTurnGaps(events)).toEqual([]);
  });

  it('flags a gap before a fresh user message that arrives without text in between', () => {
    const events = [
      userText('search emails'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      userText('any luck?'),
    ];
    // [3] = before 'any luck?' (model owed a reply to the tool result).
    // [4] = trailing — 'any luck?' itself never got a model reply either.
    expect(findEmptyTurnGaps(events)).toEqual([3, 4]);
  });

  it('flags a gap at the END of the array when the trailing turn never recovered', () => {
    const events = [
      userText('search emails'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
    ];
    expect(findEmptyTurnGaps(events)).toEqual([events.length]);
  });

  it('treats an empty-text model event as still pending', () => {
    const events = [
      userText('search emails'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      modelText(''),
      userText('any luck?'),
    ];
    // Two gaps: before the new user text (model owed a reply), and at end
    // (the new user text itself never got a real model reply either).
    expect(findEmptyTurnGaps(events)).toEqual([4, 5]);
  });

  it('flags the silent-empty-thought-turn pattern (no tool, just an empty model event)', () => {
    // The thought-only-empty-text Gemini failure mode that poisons sessions:
    // user text → model emits empty text + thoughtSignature only → user text
    // → model emits empty text → … neither of the prior guards caught it.
    const events = [
      userText('hey 10k done!'),
      modelText(''),
      userText('10k done!'),
      modelText(''),
      userText('hello?'),
    ];
    expect(findEmptyTurnGaps(events)).toEqual([2, 4, 5]);
  });

  it('flags a gap when a user text gets no model reply at all (no event emitted)', () => {
    const events = [userText('a'), userText('b'), userText('c')];
    expect(findEmptyTurnGaps(events)).toEqual([1, 2, 3]);
  });

  it('flags a trailing gap when the last event is an unanswered user text', () => {
    // Loaded at the start of the next turn — the previous user message was
    // never replied to. Inject so the model sees alternating turns.
    const events = [userText('hi'), modelText('hello'), userText('still there?')];
    expect(findEmptyTurnGaps(events)).toEqual([3]);
  });

  it('finds multiple gaps across multiple poisoned turns', () => {
    const events = [
      userText('search'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      userText('again'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      userText('hello?'),
    ];
    // Two interior gaps + one trailing — 'hello?' also never got a reply.
    expect(findEmptyTurnGaps(events)).toEqual([3, 6, 7]);
  });
});

describe('injectRecoveryEvents', () => {
  it('returns a copy when there are no gaps', () => {
    const events = [userText('hi'), modelText('hello')];
    const out = injectRecoveryEvents(events);
    expect(out).toEqual(events);
    expect(out).not.toBe(events);
  });

  it('splices a synthetic event before the next user message at each gap', () => {
    const events = [
      userText('search'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      userText('any luck?'),
    ];
    const out = injectRecoveryEvents(events);
    // 4 originals + 1 interior gap (before 'any luck?') + 1 trailing gap.
    expect(out).toHaveLength(events.length + 2);
    expect((out[3].content?.parts as Array<{ text?: string }>)[0].text).toBe('Done. What next?');
    expect(out[4]).toBe(events[3]);
    expect((out[5].content?.parts as Array<{ text?: string }>)[0].text).toBe('Done. What next?');
  });

  it('appends a synthetic event when the trailing turn never recovered', () => {
    const events = [
      userText('search'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
    ];
    const out = injectRecoveryEvents(events);
    expect(out).toHaveLength(events.length + 1);
    expect((out[3].content?.parts as Array<{ text?: string }>)[0].text).toBe('Done. What next?');
  });

  it('is idempotent — running twice produces the same result', () => {
    const events = [
      userText('search'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      userText('any luck?'),
    ];
    const once = injectRecoveryEvents(events);
    const twice = injectRecoveryEvents(once);
    expect(twice).toEqual(once);
  });

  it('filters poisoned empty-text-no-tool model events out of the result', () => {
    // The thought-only-empty-text Gemini failure mode poisons history. We
    // replace the poisoned event with a recovery synthetic so the model
    // never sees its own broken pattern in subsequent turns.
    const events = [
      userText('hey 10k done!'),
      modelText(''),
      userText('10k done!'),
      modelText(''),
      userText('hello?'),
    ];
    const out = injectRecoveryEvents(events);
    // No poisoned events remain in the output.
    expect(out.some((e) => e.author === 'lifecoach' && e.content?.role === 'model')).toBe(true);
    expect(
      out.every((e) => {
        const parts = (e.content?.parts ?? []) as Array<{ text?: string; functionCall?: unknown }>;
        if (e.content?.role !== 'model') return true;
        return parts.some(
          (p) => (typeof p.text === 'string' && p.text.length > 0) || p.functionCall,
        );
      }),
    ).toBe(true);
  });

  it('does not mutate the input array', () => {
    const events = [
      userText('search'),
      modelCall('call_workspace'),
      toolResponse('call_workspace'),
      userText('any luck?'),
    ];
    const snapshot = events.slice();
    injectRecoveryEvents(events);
    expect(events).toEqual(snapshot);
  });
});

describe('makeRecoveryEvent', () => {
  it('produces a model-role event with the given text', () => {
    const e = makeRecoveryEvent('hello', 'inv-1', () => 1234);
    expect(e.author).toBe('lifecoach');
    expect(e.content?.role).toBe('model');
    expect((e.content?.parts as Array<{ text?: string }>)[0].text).toBe('hello');
    expect(e.timestamp).toBe(1234);
  });

  it('embeds the invocationId in the event id for traceability', () => {
    const e = makeRecoveryEvent('hello', 'inv-42');
    expect(e.id).toContain('recovery-inv-42-');
  });
});
