import { describe, expect, it } from 'vitest';
import { languageDirective, isZhLang } from '../src/mcp/server.js';

describe('languageDirective', () => {
  it('is empty for unset / English (default = no change)', () => {
    expect(languageDirective(undefined)).toBe('');
    expect(languageDirective('')).toBe('');
    expect(languageDirective('en')).toBe('');
    expect(languageDirective('en-US')).toBe('');
    expect(languageDirective('English')).toBe('');
  });

  it('maps common codes to a clear language name', () => {
    const zh = languageDirective('zh');
    expect(zh).toContain('Chinese (简体中文)');
    expect(zh).toContain('Communicate with the user');
    expect(languageDirective('zh-TW')).toContain('繁體中文');
    expect(languageDirective('ja')).toContain('Japanese');
  });

  it('keeps code/identifiers English while translating prose', () => {
    const zh = languageDirective('zh');
    expect(zh).toMatch(/Keep code.*English/);
    expect(zh).toMatch(/human-facing prose is translated/);
  });

  it('passes an unknown value through verbatim', () => {
    expect(languageDirective('中文')).toContain('in 中文');
    expect(languageDirective('Français')).toContain('in Français');
  });
});

describe('isZhLang (localizes the /mcp__hover__* menu)', () => {
  it('matches every Chinese variant', () => {
    for (const v of ['zh', 'zh-CN', 'zh-Hans', 'zh-TW', 'zh-hant', 'Chinese', '中文', '简体中文']) {
      expect(isZhLang(v)).toBe(true);
    }
  });
  it('does not match other languages or unset', () => {
    for (const v of [undefined, '', 'en', 'en-US', 'English', 'ja', 'Français', 'fr']) {
      expect(isZhLang(v)).toBe(false);
    }
  });
});
