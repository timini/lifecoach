import { describe, expect, it } from 'vitest';
import { TriageReportSchema, WORKSPACE_SCOPES, WorkspaceStatusSchema } from './workspace.js';

describe('WORKSPACE_SCOPES', () => {
  it('includes full Gmail + Calendar + Tasks scopes', () => {
    expect(WORKSPACE_SCOPES).toContain('https://mail.google.com/');
    expect(WORKSPACE_SCOPES).toContain('https://www.googleapis.com/auth/calendar');
    expect(WORKSPACE_SCOPES).toContain('https://www.googleapis.com/auth/tasks');
  });

  it('does not include scopes we intentionally excluded', () => {
    for (const scope of WORKSPACE_SCOPES) {
      expect(scope).not.toMatch(/drive/);
      expect(scope).not.toMatch(/spreadsheets/);
    }
  });
});

describe('WorkspaceStatusSchema', () => {
  it('accepts a connected status', () => {
    const parsed = WorkspaceStatusSchema.parse({
      connected: true,
      scopes: Array.from(WORKSPACE_SCOPES),
      grantedAt: new Date().toISOString(),
    });
    expect(parsed.connected).toBe(true);
  });

  it('accepts a disconnected status (grantedAt null)', () => {
    const parsed = WorkspaceStatusSchema.parse({
      connected: false,
      scopes: [],
      grantedAt: null,
    });
    expect(parsed.connected).toBe(false);
  });

  it('rejects shapes that leak token fields', () => {
    // Belt-and-braces: WorkspaceStatus must never be used to carry auth values.
    // A status shape with accessToken should be a Zod parse failure, not a
    // silently-passed extra field.
    expect(() =>
      WorkspaceStatusSchema.parse({
        connected: true,
        scopes: [],
        grantedAt: null,
        accessToken: 'ya29.should-not-be-here',
      }),
    ).toThrow();
  });
});

describe('TriageReportSchema', () => {
  it('requires sender, subject, and context on every row type', () => {
    const parsed = TriageReportSchema.parse({
      noise: [
        {
          id: 'm1',
          from: 'Antler <calendar@antler.example>',
          subject: 'Interview confirmed for Tue 10:00',
          receivedAt: 'Mon, 11 May 2026 09:00:00 +0100',
          snippet: 'Your interview is confirmed for Tuesday at 10:00.',
          context: 'received Mon 09:00 — interview confirmed for Tue 10:00',
        },
      ],
      actions: [
        {
          id: 'm2',
          from: 'Alex <alex@example.com>',
          subject: 'Contract renewal',
          context: 'asks you to sign by Friday',
          task: 'Sign the renewal by Friday',
        },
      ],
      events: [
        {
          id: 'm3',
          from: 'Sarah <sarah@example.com>',
          subject: 'Lunch Tuesday 12:30?',
          context: 'lunch proposed Tuesday at 12:30',
          proposedStart: '2026-05-12T12:30:00+01:00',
        },
      ],
      info: [
        {
          id: 'm4',
          from: 'School <admin@school.example>',
          subject: 'Photo day',
          context: 'Friday photo day; uniform, no PE kit',
          note: 'Friday photo day',
        },
      ],
    });

    expect(parsed.noise[0].context).toContain('Tue 10:00');
    expect(parsed.events[0].from).toBe('Sarah <sarah@example.com>');
  });

  it('rejects context-free archive candidates', () => {
    expect(() =>
      TriageReportSchema.parse({
        noise: [{ id: 'm1', from: 'news@example.com', subject: 'Digest' }],
        actions: [],
        events: [],
        info: [],
      }),
    ).toThrow();
  });
});
