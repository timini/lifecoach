'use client';

import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';

/**
 * Floating debug overlay rendered in the bottom-right corner when the URL
 * contains `?debug=1`. Mirrors live React state so we can watch the post-
 * login transition without round-tripping through Sentry. Production-safe
 * because the gate is opt-in per-tab.
 */
export interface DebugPanelProps {
  user: User | null;
  sessionId: string;
  todaySessionId: string;
  workspaceConnected: boolean;
  drawerOpen: boolean;
  sessionsCount: number;
  sessionsSampleIds: string[];
  lastSessionsOutcome: SessionsOutcome | null;
  lastAccountMenuOpenChange: { open: boolean; at: number } | null;
  messageCount: number;
  busy: boolean;
}

export type SessionsOutcome =
  | { kind: 'skipped'; reason: string; at: number }
  | { kind: 'http_error'; status: number; at: number }
  | { kind: 'threw'; message: string; at: number }
  | { kind: 'done'; count: number; sampleIds: string[]; at: number };

function useIsDebugEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setEnabled(params.get('debug') === '1');
  }, []);
  return enabled;
}

function tsAgo(at: number): string {
  const ms = Date.now() - at;
  if (ms < 1000) return `${ms}ms ago`;
  return `${Math.floor(ms / 1000)}s ago`;
}

export function DebugPanel(props: DebugPanelProps) {
  const enabled = useIsDebugEnabled();
  const [, setTick] = useState(0);
  // Tick once a second so "Xs ago" stays fresh.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const {
    user,
    sessionId,
    todaySessionId,
    workspaceConnected,
    drawerOpen,
    sessionsCount,
    sessionsSampleIds,
    lastSessionsOutcome,
    lastAccountMenuOpenChange,
    messageCount,
    busy,
  } = props;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        zIndex: 100,
        width: 360,
        maxHeight: '60vh',
        overflow: 'auto',
        background: 'rgba(20, 20, 20, 0.95)',
        color: '#e6e6e6',
        fontSize: 11,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        lineHeight: 1.4,
        borderRadius: 8,
        padding: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        pointerEvents: 'auto',
      }}
      data-testid="debug-panel"
    >
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#9bd' }}>lifecoach debug</div>
      <Row k="user.uid" v={user?.uid ?? 'null'} />
      <Row k="user.isAnonymous" v={String(user?.isAnonymous ?? 'null')} />
      <Row
        k="user.providers"
        v={user?.providerData?.length ? user.providerData.map((p) => p.providerId).join(',') : '[]'}
      />
      <Row k="user.photoURL" v={user?.photoURL ? 'set' : 'null'} />
      <Row k="user.emailVerified" v={String(user?.emailVerified ?? 'null')} />
      <Hr />
      <Row k="sessionId" v={sessionId || 'null'} />
      <Row k="todaySessionId" v={todaySessionId || 'null'} />
      <Row k="viewMode" v={sessionId === todaySessionId ? 'live' : 'past'} />
      <Row k="workspaceConnected" v={String(workspaceConnected)} />
      <Hr />
      <Row k="sessions.count" v={String(sessionsCount)} />
      <Row k="sessions.sample" v={sessionsSampleIds.join(', ') || '[]'} />
      <Row
        k="sessions.lastFetch"
        v={lastSessionsOutcome ? formatOutcome(lastSessionsOutcome) : 'never'}
      />
      <Hr />
      <Row k="drawer.open" v={String(drawerOpen)} />
      <Row
        k="accountMenu.lastChange"
        v={
          lastAccountMenuOpenChange
            ? `${lastAccountMenuOpenChange.open ? 'opened' : 'closed'} (${tsAgo(lastAccountMenuOpenChange.at)})`
            : 'never'
        }
      />
      <Hr />
      <Row k="messages.count" v={String(messageCount)} />
      <Row k="busy" v={String(busy)} />
      <Hr />
      <div style={{ color: '#888', fontSize: 10, lineHeight: 1.4 }}>
        For the system prompt: query Cloud Logging with{' '}
        <code style={{ color: '#9bd' }}>jsonPayload.msg="chat.prompt"</code> — filter by
        <code style={{ color: '#9bd' }}> jsonPayload.uid</code> to scope to a user.
      </div>
    </div>
  );
}

function formatOutcome(o: SessionsOutcome): string {
  const ago = tsAgo(o.at);
  switch (o.kind) {
    case 'skipped':
      return `skipped: ${o.reason} (${ago})`;
    case 'http_error':
      return `http ${o.status} (${ago})`;
    case 'threw':
      return `threw: ${o.message} (${ago})`;
    case 'done':
      return `ok ${o.count} items (${ago})`;
  }
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: '#888', minWidth: 140 }}>{k}</span>
      <span style={{ wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}

function Hr() {
  return <div style={{ height: 1, background: '#333', margin: '6px 0' }} />;
}
