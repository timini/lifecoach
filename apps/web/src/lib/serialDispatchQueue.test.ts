import { describe, expect, it } from 'vitest';
import { type DispatchQueueState, SerialDispatchQueue } from './serialDispatchQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SerialDispatchQueue', () => {
  it('runs enqueued turns in order without overlapping', async () => {
    const first = deferred();
    const started: string[] = [];
    const finished: string[] = [];
    const queue = new SerialDispatchQueue<string>(
      async (value) => {
        started.push(value);
        if (value === 'first') await first.promise;
        finished.push(value);
      },
      () => {},
    );

    const firstDone = queue.enqueue('first');
    const secondDone = queue.enqueue('second');
    await Promise.resolve();

    expect(started).toEqual(['first']);
    first.resolve();
    await Promise.all([firstDone, secondDone]);
    expect(started).toEqual(['first', 'second']);
    expect(finished).toEqual(['first', 'second']);
  });

  it('reports active and waiting work', async () => {
    const gate = deferred();
    const states: DispatchQueueState[] = [];
    const queue = new SerialDispatchQueue<string>(
      async () => gate.promise,
      (state) => states.push(state),
    );

    const firstDone = queue.enqueue('first');
    const secondDone = queue.enqueue('second');
    await Promise.resolve();

    expect(states).toContainEqual({ active: true, queued: 1 });
    gate.resolve();
    await Promise.all([firstDone, secondDone]);
    expect(states.at(-1)).toEqual({ active: false, queued: 0 });
  });

  it('continues after a dispatch failure', async () => {
    const started: string[] = [];
    const queue = new SerialDispatchQueue<string>(
      async (value) => {
        started.push(value);
        if (value === 'first') throw new Error('failed');
      },
      () => {},
    );

    await Promise.all([queue.enqueue('first'), queue.enqueue('second')]);

    expect(started).toEqual(['first', 'second']);
  });
});
