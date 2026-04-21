import { describe, expect, it } from 'vitest';
import { parseSseAssistantText } from './sse';

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
