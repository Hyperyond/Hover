import { describe, test, expect } from 'vitest';
import { sanitizeRequest } from '../src/sanitize.js';
import type { ProbeRequest } from '../src/types.js';

function req(over: Partial<ProbeRequest> = {}): ProbeRequest {
  return {
    method: 'POST', url: 'https://app.test/api/me',
    headers: { cookie: 'sid=secret', 'content-type': 'application/json', authorization: 'Bearer xyz' },
    bodyText: '{"name":"alice","password":"hunter2"}', ...over,
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
  test('masks a body value containing an escaped quote without corrupting the JSON', () => {
    const s = sanitizeRequest(req({ bodyText: '{"token":"ab\\"cd","name":"alice"}' }));
    expect(s.bodyText).toContain('"token":"<redacted>"');
    expect(s.bodyText).toContain('"name":"alice"');
    expect(s.bodyText).not.toContain('ab\\"cd');
    expect(() => JSON.parse(s.bodyText!)).not.toThrow();
  });
  test('masks credential-looking query params in the URL', () => {
    const s = sanitizeRequest(req({ url: 'https://app.test/api/me?token=supersecret&page=2' }));
    expect(s.url).not.toContain('supersecret');
    expect(s.url).toContain('page=2');
    expect(s.redactions).toContain('token');
  });
  test('drops proxy-authorization too', () => {
    const s = sanitizeRequest(req({ headers: { 'proxy-authorization': 'Basic xyz' } }));
    expect(s.headers['proxy-authorization']).toBeUndefined();
    expect(s.redactions).toContain('proxy-authorization');
  });
});
