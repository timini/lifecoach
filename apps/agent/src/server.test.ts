import type { Event } from '@google/adk';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { type RunnerLike, createApp } from './server.js';

function fakeRunner(events: Partial<Event>[]): RunnerLike {
  return {
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
      for (const e of events) {
        yield e as Event;
      }
    },
  };
}

function appWith(events: Partial<Event>[] = []) {
  return createApp({ runnerFor: () => fakeRunner(events) });
}

describe('GET /health — NB: /healthz is reserved by Google Frontend on Cloud Run, use /health', () => {
  it('returns 200 with ok', async () => {
    const res = await request(appWith()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /chat', () => {
  it('streams events from the runner as SSE and terminates with event: done', async () => {
    const events: Partial<Event>[] = [
      { author: 'lifecoach', content: { role: 'model', parts: [{ text: 'Hey there!' }] } },
    ];
    const res = await request(appWith(events))
      .post('/chat')
      .send({ userId: 'u1', sessionId: 's1', message: 'hello' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('data: ');
    expect(res.text).toContain('Hey there!');
    expect(res.text).toContain('event: done');
  });

  it('returns 400 if required fields are missing', async () => {
    const res = await request(appWith()).post('/chat').send({ message: 'hi' });
    expect(res.status).toBe(400);
  });

  it('emits event: error when the runner throws', async () => {
    const app = createApp({
      runnerFor: () => ({
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
      }),
    });
    const res = await request(app)
      .post('/chat')
      .send({ userId: 'u1', sessionId: 's1', message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('boom');
  });

  it('does not fetch weather when location is absent', async () => {
    const weather = { get: vi.fn() };
    const app = createApp({ runnerFor: () => fakeRunner([]), weather });
    await request(app).post('/chat').send({ userId: 'u', sessionId: 's', message: 'hi' });
    expect(weather.get).not.toHaveBeenCalled();
  });

  it('fetches weather when location is present', async () => {
    const weather = {
      get: vi.fn().mockResolvedValue({
        current: { temperatureC: 18, windKph: 10, code: 2, time: 'now' },
        forecast: [],
      }),
    };
    const app = createApp({ runnerFor: () => fakeRunner([]), weather });
    await request(app)
      .post('/chat')
      .send({
        userId: 'u',
        sessionId: 's',
        message: 'hi',
        location: { lat: -37.81, lng: 144.96, accuracy: 20 },
      });
    expect(weather.get).toHaveBeenCalledWith({ lat: -37.81, lng: 144.96 });
  });
});
