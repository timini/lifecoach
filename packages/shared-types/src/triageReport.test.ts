import { describe, expect, it } from 'vitest';
import { TriageReportSchema } from './triageReport.js';

const validReport = {
  noise: [
    {
      id: 'm1',
      threadId: 't1',
      from: 'news@example.com',
      subject: 'Digest',
      receivedAt: 'Mon, 11 May 2026 09:00:00 +0100',
      snippet: 'Top stories this week...',
    },
  ],
  actions: [
    {
      id: 'm2',
      from: 'alex@example.com',
      subject: 'Sign-off',
      receivedAt: 'Mon, 11 May 2026 09:05:00 +0100',
      snippet: 'Please sign by Friday...',
      task: 'sign contract by Friday',
    },
  ],
  events: [
    {
      id: 'm3',
      from: 'sarah@example.com',
      subject: 'Lunch',
      receivedAt: 'Mon, 11 May 2026 09:10:00 +0100',
      snippet: 'Lunch Tuesday 12:30?',
      proposedStart: '2026-05-12T12:30:00+01:00',
    },
  ],
  info: [
    {
      id: 'm4',
      from: 'school@example.com',
      subject: 'Photo day',
      receivedAt: 'Mon, 11 May 2026 09:15:00 +0100',
      snippet: 'Photo day Friday...',
      note: 'Friday, uniform',
    },
  ],
};

describe('TriageReportSchema', () => {
  it('accepts a report with per-message context on every bucket', () => {
    expect(TriageReportSchema.parse(validReport)).toEqual(validReport);
  });

  it('requires archive-prompt context fields on noise items', () => {
    const report = structuredClone(validReport);
    const { snippet: _snippet, ...noiseWithoutSnippet } = report.noise[0];
    report.noise[0] = noiseWithoutSnippet as (typeof report.noise)[number];
    expect(() => TriageReportSchema.parse(report)).toThrow();
  });

  it('rejects a blank snippet (context must be non-empty)', () => {
    const report = structuredClone(validReport);
    report.noise[0].snippet = '';
    expect(() => TriageReportSchema.parse(report)).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => TriageReportSchema.parse({ ...validReport, extra: true })).toThrow();
  });
});
