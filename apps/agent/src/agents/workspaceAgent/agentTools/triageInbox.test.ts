import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import { TRIAGE_INBOX_TOOL_NAME, createTriageInboxTool, parseTriageReport } from './triageInbox.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

describe('triage_inbox AgentTool', () => {
  it('exposes the expected name and description (inherited from the wrapped agent)', () => {
    const tool = createTriageInboxTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(TRIAGE_INBOX_TOOL_NAME);
    expect(tool.description.toLowerCase()).toContain('triage');
    expect(tool.description.toLowerCase()).toContain('read-only');
  });
});

describe('parseTriageReport', () => {
  it('parses a valid <TRIAGE_REPORT> block', () => {
    const text = `Some preface.

<TRIAGE_REPORT>${JSON.stringify({
      noise: [{ id: 'n1', from: 'Substack', subject: 'Weekly digest' }],
      actions: [
        {
          id: 'a1',
          from: 'finance@example.com',
          subject: 'Invoice waiting',
          task: 'Pay invoice',
        },
      ],
      events: [],
      info: [],
    })}</TRIAGE_REPORT>`;
    const r = parseTriageReport(text);
    expect(r.status).toBe('ok');
    expect(r.report?.noise[0].subject).toBe('Weekly digest');
    expect(r.report?.actions[0].task).toBe('Pay invoice');
  });

  it('returns parse_error when the marker is missing', () => {
    const r = parseTriageReport('Sorry, I had no inbox to triage.');
    expect(r.status).toBe('parse_error');
    expect(r.raw).toContain('I had no inbox');
  });

  it('returns parse_error when the JSON is malformed', () => {
    const r = parseTriageReport('<TRIAGE_REPORT>{ not json }</TRIAGE_REPORT>');
    expect(r.status).toBe('parse_error');
  });

  it('returns parse_error when the JSON does not match the schema', () => {
    const r = parseTriageReport(
      `<TRIAGE_REPORT>${JSON.stringify({ noise: [{ id: 'x' }] })}</TRIAGE_REPORT>`,
    );
    expect(r.status).toBe('parse_error');
  });
});
