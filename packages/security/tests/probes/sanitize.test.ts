import { describe, test, expect } from 'vitest';
import { sanitizeRequest } from '../../src/probes/sanitize.js';
import type { FlowRequest } from '../../src/mitm/flows.js';

function req(over: Partial<FlowRequest> = {}): FlowRequest {
  return {
    method: 'POST', url: 'https://app.test/api/me', httpVersion: '1.1',
    headers: { cookie: 'sid=secret', 'content-type': 'application/json', authorization: 'Bearer xyz' },
    bodyText: '{"name":"alice","password":"hunter2"}', bodyLen: 0, startedAt: 0, ...over,
  };
}

describe('sanitizeRequest', () => {
  test('drops credential headers and records the redaction', () => {
    const s = sanitizeRequest(req());
    expect(s.headers.cookie).toBeUndefined();
    expect(s.headers.authorization).toBeUndefined();
    expect(s.headers['content-type']).toBe('application/json');
    expect(s.redactions).toEqual(expect.arrayContaining(['cookie', 'authorization']));
  });
  test('masks sensitive body fields, keeps the rest', () => {
    const s = sanitizeRequest(req());
    expect(s.bodyText).toContain('"name":"alice"');
    expect(s.bodyText).not.toContain('hunter2');
    expect(s.bodyText).toContain('"password":"<redacted>"');
    expect(s.redactions).toContain('password');
  });
  test('a null body is preserved', () => {
    expect(sanitizeRequest(req({ bodyText: null })).bodyText).toBeNull();
  });
});
