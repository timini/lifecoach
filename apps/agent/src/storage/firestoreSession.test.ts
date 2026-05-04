import type { Event } from '@google/adk';
import { describe, expect, it } from 'vitest';
import { type FirestoreLike, createFirestoreSessionService } from './firestoreSession.js';

/**
 * In-memory Firestore-like fake that covers only the minimum surface our
 * FirestoreSessionService uses: doc(path).get()/set()/delete() and
 * collection(path).get() returning an array of {id, data()} docs.
 */
function mkFirestore(): FirestoreLike & { _docs: Map<string, unknown> } {
  const docs = new Map<string, unknown>();
  return {
    _docs: docs,
    doc(path: string) {
      return {
        async get() {
          const data = docs.get(path);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
        async set(value: unknown) {
          docs.set(path, value);
        },
        async delete() {
          docs.delete(path);
        },
      };
    },
    collection(prefix: string) {
      return {
        async get() {
          const entries = Array.from(docs.entries())
            .filter(
              ([k]) =>
                k.startsWith(`${prefix}/`) && k.split('/').length === prefix.split('/').length + 1,
            )
            .map(([k, v]) => ({
              id: k.slice(prefix.length + 1),
              data: () => v,
            }));
          return { docs: entries };
        },
      };
    },
  };
}

function textEvent(text: string, author = 'lifecoach'): Event {
  return {
    invocationId: `inv-${text}`,
    author,
    id: `e-${text}`,
    actions: {
      stateDelta: {},
      artifactDelta: {},
      requestedAuthConfigs: {},
      requestedToolConfirmations: {},
    },
    longRunningToolIds: [],
    timestamp: Date.now(),
    content: { role: 'model', parts: [{ text }] },
  } as unknown as Event;
}

describe('FirestoreSessionService', () => {
  it('createSession writes a Firestore doc and returns a Session', async () => {
    const fs = mkFirestore();
    const svc = createFirestoreSessionService({ firestore: fs });

    const s = await svc.createSession({
      appName: 'lifecoach',
      userId: 'u1',
      sessionId: 's1',
    });
    expect(s.id).toBe('s1');
    expect(s.userId).toBe('u1');
    expect(s.events).toEqual([]);
    expect(fs._docs.has('apps/lifecoach/users/u1/sessions/s1')).toBe(true);
  });

  it('createSession auto-generates a sessionId when omitted', async () => {
    const svc = createFirestoreSessionService({ firestore: mkFirestore() });
    const s = await svc.createSession({ appName: 'lifecoach', userId: 'u' });
    expect(s.id).toBeTruthy();
    expect(s.id.length).toBeGreaterThan(5);
  });

  it('getSession returns undefined when the doc does not exist', async () => {
    const svc = createFirestoreSessionService({ firestore: mkFirestore() });
    const s = await svc.getSession({ appName: 'lifecoach', userId: 'u', sessionId: 'missing' });
    expect(s).toBeUndefined();
  });

  it('appendEvent persists events and getSession reads them back', async () => {
    const fs = mkFirestore();
    const svc = createFirestoreSessionService({ firestore: fs });

    const s = await svc.createSession({ appName: 'lifecoach', userId: 'u', sessionId: 's1' });
    await svc.appendEvent({ session: s, event: textEvent('hi') });
    await svc.appendEvent({ session: s, event: textEvent('there') });

    const reread = await svc.getSession({ appName: 'lifecoach', userId: 'u', sessionId: 's1' });
    expect(reread?.events).toHaveLength(2);
    expect(reread?.events?.[0]?.content?.parts?.[0]).toMatchObject({ text: 'hi' });
    expect(reread?.events?.[1]?.content?.parts?.[0]).toMatchObject({ text: 'there' });
  });

  it('getSession numRecentEvents trims to the last N', async () => {
    const fs = mkFirestore();
    const svc = createFirestoreSessionService({ firestore: fs });
    const s = await svc.createSession({ appName: 'lifecoach', userId: 'u', sessionId: 's' });
    for (let i = 0; i < 5; i++) await svc.appendEvent({ session: s, event: textEvent(`m${i}`) });

    const trimmed = await svc.getSession({
      appName: 'lifecoach',
      userId: 'u',
      sessionId: 's',
      config: { numRecentEvents: 2 },
    });
    expect(trimmed?.events).toHaveLength(2);
    expect(trimmed?.events?.[0]?.content?.parts?.[0]).toMatchObject({ text: 'm3' });
  });

  it('listSessions returns sessions for the user (events stripped per contract)', async () => {
    const svc = createFirestoreSessionService({ firestore: mkFirestore() });
    await svc.createSession({ appName: 'lifecoach', userId: 'u', sessionId: 's1' });
    await svc.createSession({ appName: 'lifecoach', userId: 'u', sessionId: 's2' });
    await svc.createSession({ appName: 'lifecoach', userId: 'other', sessionId: 'x' });

    const list = await svc.listSessions({ appName: 'lifecoach', userId: 'u' });
    expect(list.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    // Per ListSessionsResponse docstring: events/state not set on returned sessions.
    for (const s of list.sessions) {
      expect(s.events).toEqual([]);
    }
  });

  it('deleteSession removes the doc', async () => {
    const fs = mkFirestore();
    const svc = createFirestoreSessionService({ firestore: fs });
    await svc.createSession({ appName: 'lifecoach', userId: 'u', sessionId: 's' });
    expect(fs._docs.has('apps/lifecoach/users/u/sessions/s')).toBe(true);
    await svc.deleteSession({ appName: 'lifecoach', userId: 'u', sessionId: 's' });
    expect(fs._docs.has('apps/lifecoach/users/u/sessions/s')).toBe(false);
  });

  it('getSession splices recovery events into history poisoned by the empty-after-tool quirk', async () => {
    const fs = mkFirestore();
    const svc = createFirestoreSessionService({ firestore: fs });
    // Construct a poisoned session: user → fc → fr → next user (no model
    // text in between). Write directly via raw doc.set to avoid going
    // through appendEvent (which validates and would reject).
    const path = 'apps/lifecoach/users/u/sessions/s1';
    fs._docs.set(path, {
      id: 's1',
      appName: 'lifecoach',
      userId: 'u',
      state: {},
      events: [
        { author: 'user', content: { role: 'user', parts: [{ text: 'search' }] } },
        {
          author: 'lifecoach',
          content: { role: 'model', parts: [{ functionCall: { name: 'call_workspace' } }] },
        },
        {
          author: 'user',
          content: {
            role: 'user',
            parts: [{ functionResponse: { name: 'call_workspace', response: { status: 'ok' } } }],
          },
        },
        { author: 'user', content: { role: 'user', parts: [{ text: 'any luck?' }] } },
      ],
      lastUpdateTime: 0,
    });

    const session = await svc.getSession({
      appName: 'lifecoach',
      userId: 'u',
      sessionId: 's1',
    });
    // 4 originals + 2 recoveries: one before the second user message
    // (model owed a reply to the tool result) and one trailing (the new
    // user message itself never got a reply either).
    expect(session?.events).toHaveLength(6);
    const recovered = session?.events?.[3];
    expect(recovered?.author).toBe('lifecoach');
    expect(recovered?.content?.role).toBe('model');
    expect((recovered?.content?.parts as Array<{ text?: string }>)?.[0]?.text).toBeTruthy();
    const trailing = session?.events?.[5];
    expect((trailing?.content?.parts as Array<{ text?: string }>)?.[0]?.text).toBeTruthy();

    // Firestore doc itself was NOT mutated — the splice is in-memory only.
    const doc = fs._docs.get(path) as { events: unknown[] };
    expect(doc.events).toHaveLength(4);
  });
});
