import { describe, test, expect } from 'vitest';
import { buildCdpHint, buildCdpHintResume } from '../../src/service/cdpHint.js';

const TABS = [{ url: 'http://localhost:5173/', title: 'basic-app' }];

describe('buildCdpHint — scope discipline', () => {
  test('gates exploration depth on prompt specificity (two modes)', () => {
    const hint = buildCdpHint(TABS);
    // Specific prompts must stay in scope, not over-test.
    expect(hint).toContain('SPECIFIC prompt');
    expect(hint).toContain('then STOP');
    expect(hint).toContain('Do NOT wander');
    expect(hint).toContain('adjacent flows');
    // Vague prompts still get the exploratory pass.
    expect(hint).toContain('VAGUE or short prompt');
    expect(hint).toContain('exploratory test pass');
  });

  test('no longer frames bug-hunting as an always-on standing mission', () => {
    const hint = buildCdpHint(TABS);
    expect(hint).not.toContain('standing mission');
  });

  test('still carries the navigation guard for the active origin', () => {
    const hint = buildCdpHint(TABS);
    expect(hint).toContain('http://localhost:5173');
    expect(hint).toContain('Do NOT call browser_navigate');
  });

  test('returns empty string when there are no tabs', () => {
    expect(buildCdpHint([])).toBe('');
  });
});

describe('buildCdpHintResume', () => {
  test('is the volatile-only tab refresh, not the full rules block', () => {
    const resume = buildCdpHintResume(TABS);
    expect(resume).toContain('Current Chrome tabs');
    expect(resume).toContain('http://localhost:5173');
    // Stable rules must NOT be re-sent (prompt-cache fingerprint).
    expect(resume).not.toContain('SPECIFIC prompt');
    expect(resume).not.toContain('Navigation rules');
  });

  test('returns empty string when there are no tabs', () => {
    expect(buildCdpHintResume([])).toBe('');
  });
});
