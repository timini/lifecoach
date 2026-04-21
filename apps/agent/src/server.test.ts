import type { Event } from '@google/adk';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { type RunnerLike, createApp } from './server.js';

function fakeRunner(events: Partial<Event>[]): RunnerLike {
  return {
    appName: 'test',
    sessionService: {
      async createSession() {
        return { id: 's', userId: 'u', appName: 'test', events: [], state: {}, lastUpdateTime: 0 };
      },
      async getSession() {
        return null;
      },
    },
    async *runAsync() {
      for (const e of events) {
        yield e as Event;
      }
    },
  };
}

function lastAssistantText(events: Partial<Event>[]): string {
  for (const e of [...events].reverse()) {
    const text = e.content?.parts?.find((p) => p.text)?.text;
    if (text) return text;
  }
  return '';
}

describe('GET /health — NB: /healthz is reserved by Google Frontend on Cloud Run, use /health', () => {
  it('returns 200 with ok', async () => {
    const app = createApp({ runner: fakeRunner([]) });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /chat', () => {
  it('streams events from the runner as SSE and terminates with event: done', async () => {
    const events: Partial<Event>[] = [
      { author: 'lifecoach', content: { role: 'model', parts: [{ text: 'Hey there!' }] } },
    ];
    const app = createApp({ runner: fakeRunner(events) });
    const res = await request(app)
      .post('/chat')
      .send({ userId: 'u1', sessionId: 's1', message: 'hello' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('data: ');
    expect(res.text).toContain('Hey there!');
    expect(res.text).toContain('event: done');
    expect(lastAssistantText(events)).toBe('Hey there!');
  });

  it('returns 400 if required fields are missing', async () => {
    const app = createApp({ runner: fakeRunner([]) });
    const res = await request(app).post('/chat').send({ message: 'hi' });
    expect(res.status).toBe(400);
  });

  it('emits event: error when the runner throws', async () => {
    const runner: RunnerLike = {
      appName: 'test',
      sessionService: {
        async createSession() {
          return {
            id: 's',
            userId: 'u',
            appName: 'test',
            events: [],
            state: {},
            lastUpdateTime: 0,
          };
        },
        async getSession() {
          return null;
        },
      },
      async *runAsync() {
        // biome-ignore lint/correctness/useYield: intentional — test the throw path
        throw new Error('boom');
      },
    };
    const app = createApp({ runner });
    const res = await request(app)
      .post('/chat')
      .send({ userId: 'u1', sessionId: 's1', message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('boom');
  });
});
