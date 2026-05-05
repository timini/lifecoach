import type { GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { createGeminiFlashLiteSummarizer } from './sessionSummarizer.js';

interface FakeGenAI {
  models: { generateContent: ReturnType<typeof vi.fn> };
}

function fakeClient(generate: (...args: unknown[]) => unknown | Promise<unknown>): FakeGenAI {
  return { models: { generateContent: vi.fn(generate) } };
}

describe('createGeminiFlashLiteSummarizer', () => {
  it('calls Flash Lite with the transcript and returns the response text', async () => {
    const client = fakeClient(async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: 'A clean one-paragraph summary of the day.' }],
          },
        },
      ],
    }));
    const summarize = createGeminiFlashLiteSummarizer({
      client: client as unknown as GoogleGenAI,
      model: 'gemini-flash-lite-latest',
    });
    const result = await summarize('User: hi\nCoach: hi');
    expect(result).toBe('A clean one-paragraph summary of the day.');
    const call = client.models.generateContent.mock.calls[0]?.[0] as {
      model: string;
      contents: unknown[];
    };
    expect(call.model).toBe('gemini-flash-lite-latest');
    // The transcript appears as one of the parts in the user content.
    expect(JSON.stringify(call.contents)).toMatch(/User: hi/);
  });

  it('returns null when the response has no text parts', async () => {
    const client = fakeClient(async () => ({ candidates: [{ content: { parts: [] } }] }));
    const summarize = createGeminiFlashLiteSummarizer({ client: client as unknown as GoogleGenAI });
    expect(await summarize('User: hi')).toBeNull();
  });

  it('returns null when the SDK throws (the turn must not crash on summary failure)', async () => {
    const client = fakeClient(async () => {
      throw new Error('quota exceeded');
    });
    const summarize = createGeminiFlashLiteSummarizer({ client: client as unknown as GoogleGenAI });
    expect(await summarize('User: hi')).toBeNull();
  });

  it('short-circuits empty/whitespace transcripts without calling the SDK', async () => {
    const client = fakeClient(async () => ({
      candidates: [{ content: { parts: [{ text: 'x' }] } }],
    }));
    const summarize = createGeminiFlashLiteSummarizer({ client: client as unknown as GoogleGenAI });
    expect(await summarize('   ')).toBeNull();
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });
});
