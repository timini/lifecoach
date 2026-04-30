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
    expect(findEmptyTurnGaps(events)).toEqual([3]);
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
    expect(findEmptyTurnGaps(events)).toEqual([4]);
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
    expect(findEmptyTurnGaps(events)).toEqual([3, 6]);
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
    expect(out).toHaveLength(events.length + 1);
    // Gap was at index 3; injected event sits at index 3, original [3] shifts to [4].
    expect((out[3].content?.parts as Array<{ text?: string }>)[0].text).toBe('Done. What next?');
    expect(out[4]).toBe(events[3]);
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
