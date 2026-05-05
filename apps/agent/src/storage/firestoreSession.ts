/**
 * Firestore-backed ADK SessionService.
 *
 * Storage layout — one doc per session:
 *   apps/{appName}/users/{userId}/sessions/{sessionId}
 *     { id, appName, userId, state, events: Event[], lastUpdateTime }
 *
 * Why document-with-events-array (not events subcollection)?
 *   - Simpler reads — one doc fetch gets the full replay state the agent
 *     needs at the start of each turn.
 *   - Firestore docs cap at 1 MiB. 100 typical chat turns × ~2 KiB each is
 *     well under that. When we need longer sessions, move events to a
 *     subcollection — the BaseSessionService interface doesn't care.
 *
 * We depend on a minimal Firestore surface (`FirestoreLike`) so tests can
 * pass an in-memory fake. Production uses @google-cloud/firestore.
 */

import {
  type AppendEventRequest,
  BaseSessionService,
  type CreateSessionRequest,
  type DeleteSessionRequest,
  type Event,
  type GetSessionRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type Session,
} from '@google/adk';
import { injectRecoveryEvents } from '../chat/emptyTurnGuard.js';

export interface FirestoreDocRef {
  get(): Promise<{ exists: boolean; data(): unknown }>;
  set(value: unknown, options?: { merge?: boolean }): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface FirestoreCollectionRef {
  get(): Promise<{ docs: Array<{ id: string; data(): unknown }> }>;
}

export interface FirestoreLike {
  doc(path: string): FirestoreDocRef;
  collection(path: string): FirestoreCollectionRef;
}

interface StoredSession {
  id: string;
  appName: string;
  userId: string;
  state: Record<string, unknown>;
  events: Event[];
  lastUpdateTime: number;
}

function sessionPath(appName: string, userId: string, sessionId: string): string {
  return `apps/${appName}/users/${userId}/sessions/${sessionId}`;
}

function collectionPath(appName: string, userId: string): string {
  return `apps/${appName}/users/${userId}/sessions`;
}

function generateSessionId(): string {
  // 12 hex chars — plenty for a per-user ID space.
  return `s-${Math.random().toString(16).slice(2, 8)}${Math.random().toString(16).slice(2, 8)}`;
}

class FirestoreSessionService extends BaseSessionService {
  constructor(private readonly fs: FirestoreLike) {
    super();
  }

  async createSession(req: CreateSessionRequest): Promise<Session> {
    const sessionId = req.sessionId ?? generateSessionId();
    const session: StoredSession = {
      id: sessionId,
      appName: req.appName,
      userId: req.userId,
      state: req.state ?? {},
      events: [],
      lastUpdateTime: Date.now(),
    };
    await this.fs.doc(sessionPath(req.appName, req.userId, sessionId)).set(session);
    return session;
  }

  async getSession(req: GetSessionRequest): Promise<Session | undefined> {
    const snap = await this.fs.doc(sessionPath(req.appName, req.userId, req.sessionId)).get();
    if (!snap.exists) return undefined;
    const stored = snap.data() as StoredSession | undefined;
    if (!stored) return undefined;
    let events = stored.events ?? [];
    if (req.config?.numRecentEvents && req.config.numRecentEvents > 0) {
      events = events.slice(-req.config.numRecentEvents);
    }
    if (req.config?.afterTimestamp) {
      const after = req.config.afterTimestamp;
      events = events.filter((e) => (e.timestamp ?? 0) > after);
    }
    // Repair sessions poisoned by the Gemini empty-text-after-tool quirk:
    // splice synthetic recovery events into any gap where a tool result
    // wasn't followed by model text. In-memory only — Firestore is the
    // source of truth and stays unmodified.
    events = injectRecoveryEvents(events);
    return { ...stored, events };
  }

  async listSessions(req: ListSessionsRequest): Promise<ListSessionsResponse> {
    const snap = await this.fs.collection(collectionPath(req.appName, req.userId)).get();
    const sessions: Session[] = snap.docs.map((d) => {
      const s = d.data() as StoredSession;
      // Contract: listSessions does not populate events/state.
      return {
        id: s.id,
        appName: s.appName,
        userId: s.userId,
        state: {},
        events: [],
        lastUpdateTime: s.lastUpdateTime,
      };
    });
    return { sessions };
  }

  async deleteSession(req: DeleteSessionRequest): Promise<void> {
    await this.fs.doc(sessionPath(req.appName, req.userId, req.sessionId)).delete();
  }

  override async appendEvent({ session, event }: AppendEventRequest): Promise<Event> {
    // Defer to the base implementation's state-update semantics (it mutates
    // session.state based on event.actions.stateDelta) by calling super.
    await super.appendEvent({ session, event });
    // Then persist the whole session. A full write per event keeps the
    // implementation simple; Firestore writes are small and this scales
    // fine for chat-length sessions. Revisit if we ever need 1000+
    // events/session.
    const stored: StoredSession = {
      id: session.id,
      appName: session.appName,
      userId: session.userId,
      state: session.state,
      events: session.events,
      lastUpdateTime: Date.now(),
    };
    await this.fs.doc(sessionPath(session.appName, session.userId, session.id)).set(stored);
    return event;
  }
}

export function createFirestoreSessionService(deps: {
  firestore: FirestoreLike;
}): FirestoreSessionService {
  return new FirestoreSessionService(deps.firestore);
}

/**
 * Persist a one-paragraph session summary onto the existing session doc's
 * `state.summary` + `state.summaryGeneratedAt`. Used by sessionSummary.ts
 * after a Flash Lite call. We merge so we don't clobber any other fields
 * the ADK base class wrote into `state`.
 */
export async function saveSessionSummary(deps: {
  firestore: FirestoreLike;
  appName: string;
  userId: string;
  sessionId: string;
  summary: string;
  generatedAt: number;
}): Promise<void> {
  await deps.firestore.doc(sessionPath(deps.appName, deps.userId, deps.sessionId)).set(
    {
      state: {
        summary: deps.summary,
        summaryGeneratedAt: deps.generatedAt,
      },
    },
    { merge: true },
  );
}

export type { FirestoreSessionService };
