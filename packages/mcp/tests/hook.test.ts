import { describe, expect, it } from 'vitest';
import { looksLikeFeatureWork } from '../src/hook.js';

describe('looksLikeFeatureWork', () => {
  it('fires on verb + feature-ish noun', () => {
    expect(looksLikeFeatureWork('add a checkout flow')).toBe(true);
    expect(looksLikeFeatureWork('implement the login page')).toBe(true);
    expect(looksLikeFeatureWork('build a settings screen')).toBe(true);
    expect(looksLikeFeatureWork('create a new signup form')).toBe(true);
  });

  it('stays quiet on non-feature prompts', () => {
    expect(looksLikeFeatureWork('fix the typo in the readme')).toBe(false);
    expect(looksLikeFeatureWork('why is this test flaky?')).toBe(false);
    expect(looksLikeFeatureWork('rename the variable')).toBe(false);
    expect(looksLikeFeatureWork('')).toBe(false);
  });
});
