import { describe, expect, it } from 'vitest';
import { TriageReportSchema } from './workspaceTriage.js';

describe('TriageReportSchema', () => {
  it('requires sender, subject, and context on every bucket row', () => {
    const parsed = TriageReportSchema.parse({
      noise: [
        {
          id: 'm1',
          from: 'Newsletter <n@example.com>',
          subject: 'Weekly digest',
          context: 'received 2h ago; automated digest',
        },
      ],
      actions: [
        {
          id: 'm2',
          from: 'Alex <alex@example.com>',
          subject: 'Contract renewal',
          context: 'received today; asks for sign-off by Friday',
          task: 'Sign the contract by Friday',
        },
      ],
      events: [
        {
          id: 'm3',
          from: 'Sarah <sarah@example.com>',
          subject: 'Lunch Tuesday 12:30?',
          context: 'received yesterday; lunch Tue 12:30 at Tortilla',
          proposedStart: '2026-05-12T12:30:00+01:00',
        },
      ],
      info: [
        {
          id: 'm4',
          from: 'School <admin@school.example>',
          subject: 'Photo day',
          context: 'received yesterday; Year 3 photo day Friday',
          note: 'Maya needs uniform Friday',
        },
      ],
    });

    expect(parsed.noise[0].context).toContain('received 2h ago');
    expect(parsed.events[0].from).toContain('Sarah');
  });

  it('rejects archive candidates without context', () => {
    expect(() =>
      TriageReportSchema.parse({
        noise: [{ id: 'm1', from: 'n@example.com', subject: 'Digest' }],
        actions: [],
        events: [],
        info: [],
      }),
    ).toThrow();
  });
});
