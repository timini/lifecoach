import { MessageProjectionSchema } from '@lifecoach/shared-types';
import { describe, expect, it } from 'vitest';
import { projectGmailMessage } from './gmailMessage.js';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('projectGmailMessage', () => {
  it('decodes a single-part text/plain body', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      snippet: 'hi there…',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'Sarah <sarah@example.com>' },
          { name: 'Subject', value: 'Lunch?' },
          { name: 'Date', value: 'Mon, 06 May 2026 09:12:00 +0100' },
        ],
        body: { data: b64url('Are you free for lunch on Tuesday?') },
      },
    });
    expect(projection.body).toBe('Are you free for lunch on Tuesday?');
    expect(projection.subject).toBe('Lunch?');
    expect(projection.from).toBe('Sarah <sarah@example.com>');
    expect(projection.truncated).toBe(false);
    expect(MessageProjectionSchema.parse(projection)).toEqual(projection);
  });

  it('prefers text/plain over text/html in multipart', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [{ name: 'Subject', value: 'x' }],
        parts: [
          {
            mimeType: 'text/html',
            body: { data: b64url('<b>HTML body</b>') },
          },
          {
            mimeType: 'text/plain',
            body: { data: b64url('Plain body') },
          },
        ],
      },
    });
    expect(projection.body).toBe('Plain body');
  });

  it('falls back to text/html with tag-strip when no plain part', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/html',
        headers: [{ name: 'Subject', value: 'x' }],
        body: {
          data: b64url(
            '<style>.x{color:red}</style><script>alert(1)</script><p>Hello&nbsp;<b>world</b></p>',
          ),
        },
      },
    });
    expect(projection.body).toBe('Hello world');
  });

  it('walks nested multipart trees to find the text part', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/html', body: { data: b64url('<i>nope</i>') } },
              { mimeType: 'text/plain', body: { data: b64url('deep plain') } },
            ],
          },
          { mimeType: 'application/pdf', filename: 'invoice.pdf' },
        ],
      },
    });
    expect(projection.body).toBe('deep plain');
  });

  it('caps body at 4 KB and marks truncated', () => {
    const big = 'a'.repeat(8000);
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/plain',
        body: { data: b64url(big) },
      },
    });
    expect(projection.truncated).toBe(true);
    expect(projection.body.length).toBeLessThanOrEqual(4096 + 32);
    expect(projection.body.endsWith('…[truncated]')).toBe(true);
  });

  it('filters headers to the allow-list and canonicalises names', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@b' },
          { name: 'Subject', value: 'x' },
          { name: 'Date', value: 'd' },
          { name: 'List-Unsubscribe', value: '<https://x/u>' },
          { name: 'DKIM-Signature', value: 'sig' },
          { name: 'Received', value: 'from foo' },
          { name: 'Reply-To', value: 'reply@b' },
        ],
        body: { data: b64url('hi') },
      },
    });
    expect(projection.headers).toEqual({
      'List-Unsubscribe': '<https://x/u>',
      'Reply-To': 'reply@b',
    });
    // From / Subject / Date are promoted, not duplicated under headers.
    expect(projection.headers).not.toHaveProperty('From');
  });

  it('omits headers entirely if none survive the allow-list', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@b' },
          { name: 'DKIM-Signature', value: 'sig' },
        ],
        body: { data: b64url('hi') },
      },
    });
    expect(projection.headers).toBeUndefined();
  });

  it('tolerates a missing payload gracefully', () => {
    const projection = projectGmailMessage({ id: 'm1', threadId: 't1' });
    expect(projection.body).toBe('');
    expect(projection.subject).toBe('');
    expect(projection.from).toBe('');
    expect(projection.truncated).toBe(false);
  });

  it('falls back to id for threadId when threadId is missing', () => {
    const projection = projectGmailMessage({ id: 'm1' });
    expect(projection.threadId).toBe('m1');
  });

  it('does not throw on malformed base64url', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/plain',
        body: { data: '%%%not-base64%%%' },
      },
    });
    // Buffer.from('%%%', 'base64url') tolerates invalid chars (silently
    // returns garbage); we just need to not blow up.
    expect(typeof projection.body).toBe('string');
  });

  it('treats case-insensitive header names', () => {
    const projection = projectGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'FROM', value: 'a@b' },
          { name: 'subject', value: 'x' },
          { name: 'DATE', value: 'd' },
        ],
        body: { data: b64url('hi') },
      },
    });
    expect(projection.from).toBe('a@b');
    expect(projection.subject).toBe('x');
    expect(projection.date).toBe('d');
  });
});
