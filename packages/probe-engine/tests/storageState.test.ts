import { describe, test, expect } from 'vitest';
import { cookieHeaderFor, type StorageState } from '../src/storageState.js';

const state: StorageState = {
  cookies: [
    { name: 'sid', value: 'abc', domain: 'app.test', path: '/' },
    { name: 'pref', value: 'dark', domain: '.app.test', path: '/' },
    { name: 'other', value: 'x', domain: 'evil.test', path: '/' },
  ],
};

describe('cookieHeaderFor', () => {
  test('includes cookies whose domain matches the URL host', () => {
    const h = cookieHeaderFor(state, 'https://app.test/api/orders?id=1');
    expect(h).toContain('sid=abc');
    expect(h).toContain('pref=dark'); // dot-prefixed parent domain matches
    expect(h).not.toContain('other=x'); // different host
  });
  test('matches a subdomain against a dot-prefixed cookie domain', () => {
    const h = cookieHeaderFor(state, 'https://api.app.test/x');
    expect(h).toContain('pref=dark'); // .app.test covers api.app.test
    expect(h).not.toContain('sid=abc'); // exact app.test does not cover the subdomain
  });
  test('returns empty string when no cookie matches', () => {
    expect(cookieHeaderFor(state, 'https://nope.test/')).toBe('');
  });
  test('returns empty string for a malformed URL', () => {
    expect(cookieHeaderFor(state, 'not a url')).toBe('');
  });
  test('tolerates a state with no cookies', () => {
    expect(cookieHeaderFor({}, 'https://app.test/')).toBe('');
  });
});
