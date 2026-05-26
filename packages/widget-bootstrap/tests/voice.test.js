import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  humanizeTool,
  detectLanguage,
  pickVoice,
  shouldSpeak,
  detectVoiceSupport,
  waitForVoices,
} from '../src/widget/voice.js';

describe('humanizeTool — English', () => {
  it('says "Opening page" for browser_navigate (no URL read aloud)', () => {
    expect(humanizeTool('browser_navigate', { url: 'http://localhost:5173/login' }, 'en'))
      .toBe('Opening page');
  });

  it('humanizes browser_click with element label', () => {
    expect(humanizeTool('browser_click', { element: 'Login button' }, 'en'))
      .toBe('Clicking Login button');
  });

  it('humanizes browser_click without label', () => {
    expect(humanizeTool('browser_click', {}, 'en')).toBe('Clicking');
  });

  it('humanizes browser_fill_form', () => {
    expect(humanizeTool('browser_fill_form', { fields: [] }, 'en')).toBe('Filling form');
  });

  it('strips mcp__playwright__ prefix', () => {
    expect(humanizeTool('mcp__playwright__browser_navigate', { url: 'x' }, 'en'))
      .toBe('Opening page');
  });

  it('returns null for noisy / diagnostic tools', () => {
    for (const t of [
      'browser_snapshot',
      'browser_take_screenshot',
      'browser_resize',
      'browser_evaluate',
      'browser_console_messages',
      'browser_network_requests',
    ]) {
      expect(humanizeTool(t, {}, 'en')).toBe(null);
    }
  });

  it('returns null for tabs.list, speaks tabs.select/new', () => {
    expect(humanizeTool('browser_tabs', { action: 'list' }, 'en')).toBe(null);
    expect(humanizeTool('browser_tabs', { action: 'select' }, 'en')).toBe('Switching tab');
    expect(humanizeTool('browser_tabs', { action: 'new' }, 'en')).toBe('Opening new tab');
  });

  it('returns null for unknown tools', () => {
    expect(humanizeTool('something_random', {}, 'en')).toBe(null);
    expect(humanizeTool('Skill', {}, 'en')).toBe(null);
  });

  it('handles non-string tool names gracefully', () => {
    expect(humanizeTool(null, {}, 'en')).toBe(null);
    expect(humanizeTool(undefined, {}, 'en')).toBe(null);
    expect(humanizeTool(42, {}, 'en')).toBe(null);
  });

  it('clips long click labels', () => {
    const long = 'This is a very long button label that should be clipped';
    const out = humanizeTool('browser_click', { element: long }, 'en');
    expect(out.length).toBeLessThan(50);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('humanizeTool — Chinese', () => {
  it('says 打开页面 for browser_navigate (no URL)', () => {
    expect(humanizeTool('browser_navigate', { url: 'http://localhost:5173/login' }, 'zh'))
      .toBe('打开页面');
  });

  it('says 点击 + label for clicks', () => {
    expect(humanizeTool('browser_click', { element: '登录按钮' }, 'zh'))
      .toBe('点击登录按钮');
    expect(humanizeTool('browser_click', { text: '登录' }, 'zh'))
      .toBe('点击登录');
    expect(humanizeTool('browser_click', {}, 'zh')).toBe('点击');
  });

  it('translates form / type / select / wait / tabs / close', () => {
    expect(humanizeTool('browser_fill_form', {}, 'zh')).toBe('填写表单');
    expect(humanizeTool('browser_type', { element: '密码框' }, 'zh')).toBe('在密码框里输入');
    expect(humanizeTool('browser_select_option', { element: '州' }, 'zh')).toBe('选择州');
    expect(humanizeTool('browser_wait_for', {}, 'zh')).toBe('等待中');
    expect(humanizeTool('browser_tabs', { action: 'select' }, 'zh')).toBe('切换标签页');
    expect(humanizeTool('browser_close', {}, 'zh')).toBe('关闭浏览器');
  });

  it('defaults to English when langHint is omitted', () => {
    expect(humanizeTool('browser_navigate', { url: 'x' })).toBe('Opening page');
  });
});

describe('detectLanguage', () => {
  it('detects Chinese from CJK characters', () => {
    expect(detectLanguage('测试登录流程')).toBe('zh');
    expect(detectLanguage('Open 登录 page')).toBe('zh'); // mixed → zh wins
  });

  it('defaults to English for non-CJK', () => {
    expect(detectLanguage('test the login flow')).toBe('en');
    expect(detectLanguage('Hello world')).toBe('en');
  });

  it('returns en for empty / non-string input', () => {
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage(null)).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
    expect(detectLanguage(42)).toBe('en');
  });
});

describe('pickVoice', () => {
  const mkSynth = (voices) => ({ getVoices: () => voices });

  it('prefers Siri over legacy Tingting for zh queries', () => {
    const siri = { lang: 'zh-CN', name: 'Siri (Chinese, Mainland)', default: false };
    const tingting = { lang: 'zh-CN', name: 'Tingting', default: true };
    const synth = mkSynth([tingting, siri]);
    expect(pickVoice(synth, 'zh')).toBe(siri);
  });

  it('prefers Google voice on Chrome desktop', () => {
    const google = { lang: 'zh-CN', name: 'Google 中文（中国大陆）', default: false };
    const tingting = { lang: 'zh-CN', name: 'Tingting', default: true };
    const synth = mkSynth([tingting, google]);
    expect(pickVoice(synth, 'zh')).toBe(google);
  });

  it('prefers Premium / Enhanced suffix over plain voice', () => {
    const enhanced = { lang: 'en-US', name: 'Samantha (Enhanced)', default: false };
    const plain = { lang: 'en-US', name: 'Samantha', default: true };
    const synth = mkSynth([plain, enhanced]);
    expect(pickVoice(synth, 'en')).toBe(enhanced);
  });

  it('prefers zh-CN over zh-TW for zh queries', () => {
    const cn = { lang: 'zh-CN', name: 'A', default: false };
    const tw = { lang: 'zh-TW', name: 'B', default: true };
    const synth = mkSynth([tw, cn]);
    expect(pickVoice(synth, 'zh')).toBe(cn);
  });

  it('falls back to any match when nothing scores', () => {
    const only = { lang: 'zh-CN', name: 'A', default: false };
    const synth = mkSynth([only, { lang: 'en-US', name: 'X', default: false }]);
    expect(pickVoice(synth, 'zh')).toBe(only);
  });

  it('returns null when no voice matches the language', () => {
    const synth = mkSynth([{ lang: 'fr-FR', name: 'Amelie', default: true }]);
    expect(pickVoice(synth, 'zh')).toBe(null);
    expect(pickVoice(synth, 'en')).toBe(null);
  });

  it('returns null when synth is null / missing getVoices / empty voices', () => {
    expect(pickVoice(null, 'en')).toBe(null);
    expect(pickVoice({}, 'en')).toBe(null);
    expect(pickVoice(mkSynth([]), 'en')).toBe(null);
  });
});

describe('waitForVoices', () => {
  it('resolves immediately when voices already populated', async () => {
    const synth = {
      getVoices: () => [{ lang: 'en-US', name: 'A' }],
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const out = await waitForVoices(synth, 50);
    expect(out.length).toBe(1);
  });

  it('resolves on voiceschanged event when voices arrive later', async () => {
    let voices = [];
    let handler = null;
    const synth = {
      getVoices: () => voices,
      addEventListener: (ev, h) => { if (ev === 'voiceschanged') handler = h; },
      removeEventListener: () => { handler = null; },
    };
    const p = waitForVoices(synth, 200);
    // Simulate Chrome firing the event after a tick.
    setTimeout(() => {
      voices = [{ lang: 'zh-CN', name: 'Siri' }];
      if (handler) handler();
    }, 10);
    const out = await p;
    expect(out.length).toBe(1);
    expect(out[0].name).toBe('Siri');
  });

  it('resolves on timeout if voices never arrive', async () => {
    const synth = {
      getVoices: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const start = Date.now();
    const out = await waitForVoices(synth, 50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    expect(out).toEqual([]);
  });

  it('resolves to [] when synth is null', async () => {
    expect(await waitForVoices(null, 50)).toEqual([]);
  });
});

describe('shouldSpeak', () => {
  it('speaks tool_use in English by default', () => {
    const r = shouldSpeak({ kind: 'tool_use', tool: 'browser_click', input: { element: 'Submit' } });
    expect(r).toEqual({ speak: true, text: 'Clicking Submit' });
  });

  it('speaks tool_use in Chinese when langHint=zh', () => {
    const r = shouldSpeak(
      { kind: 'tool_use', tool: 'browser_click', input: { element: '登录' } },
      'zh',
    );
    expect(r).toEqual({ speak: true, text: '点击登录' });
  });

  it('stays silent on unknown / noisy tool_use', () => {
    expect(shouldSpeak({ kind: 'tool_use', tool: 'browser_snapshot', input: {} }))
      .toEqual({ speak: false, text: null });
    expect(shouldSpeak({ kind: 'tool_use', tool: 'WeirdInternalTool', input: {} }))
      .toEqual({ speak: false, text: null });
  });

  it('speaks first sentence of text capped at 60 chars', () => {
    const r = shouldSpeak({ kind: 'text', text: 'Login worked. Now checking inbox.' });
    expect(r.speak).toBe(true);
    expect(r.text).toBe('Login worked');
    const long = 'x'.repeat(300);
    const r2 = shouldSpeak({ kind: 'text', text: long });
    expect(r2.text.length).toBeLessThanOrEqual(61);
    expect(r2.text.endsWith('…')).toBe(true);
  });

  it('stays silent on empty text', () => {
    expect(shouldSpeak({ kind: 'text', text: '' })).toEqual({ speak: false, text: null });
    expect(shouldSpeak({ kind: 'text', text: '   ' })).toEqual({ speak: false, text: null });
  });

  it('says Stopped / 已停止 on cancelled session_end', () => {
    expect(shouldSpeak({ kind: 'session_end', cancelled: true, turns: 3 }))
      .toEqual({ speak: true, text: 'Stopped.' });
    expect(shouldSpeak({ kind: 'session_end', cancelled: true }, 'zh'))
      .toEqual({ speak: true, text: '已停止' });
  });

  it('says error / 出错了 on errored session_end', () => {
    expect(shouldSpeak({ kind: 'session_end', isError: true }))
      .toEqual({ speak: true, text: 'Something went wrong.' });
    expect(shouldSpeak({ kind: 'session_end', isError: true }, 'zh'))
      .toEqual({ speak: true, text: '出错了' });
  });

  it('says Done in N steps / 完成 共 N 步 on normal session_end', () => {
    expect(shouldSpeak({ kind: 'session_end', turns: 5 }))
      .toEqual({ speak: true, text: 'Done in 5 steps.' });
    expect(shouldSpeak({ kind: 'session_end', turns: 1 }))
      .toEqual({ speak: true, text: 'Done in 1 step.' });
    expect(shouldSpeak({ kind: 'session_end', turns: 4 }, 'zh'))
      .toEqual({ speak: true, text: '完成，共 4 步' });
    expect(shouldSpeak({ kind: 'session_end' }, 'zh'))
      .toEqual({ speak: true, text: '完成' });
  });

  it('prefers summary first sentence on session_end', () => {
    const r = shouldSpeak({
      kind: 'session_end',
      turns: 4,
      summary: 'Verified login and todo creation. All checks passed.',
    });
    expect(r.text).toBe('Verified login and todo creation');
  });

  it('stays silent on noisy kinds', () => {
    expect(shouldSpeak({ kind: 'session_start', sessionId: 'abc' }))
      .toEqual({ speak: false, text: null });
    expect(shouldSpeak({ kind: 'mcp_status', server: 'playwright', status: 'connected' }))
      .toEqual({ speak: false, text: null });
    expect(shouldSpeak({ kind: 'tool_result', isError: false }))
      .toEqual({ speak: false, text: null });
    expect(shouldSpeak({ kind: 'usage', costUsd: 0.01 }))
      .toEqual({ speak: false, text: null });
    expect(shouldSpeak({ kind: 'raw', line: '...' }))
      .toEqual({ speak: false, text: null });
  });

  it('handles malformed events gracefully', () => {
    expect(shouldSpeak(null)).toEqual({ speak: false, text: null });
    expect(shouldSpeak(undefined)).toEqual({ speak: false, text: null });
    expect(shouldSpeak({})).toEqual({ speak: false, text: null });
  });
});

describe('detectVoiceSupport', () => {
  const originals = {};

  beforeEach(() => {
    originals.SpeechRecognition = globalThis.SpeechRecognition;
    originals.webkitSpeechRecognition = globalThis.webkitSpeechRecognition;
    originals.speechSynthesis = globalThis.speechSynthesis;
    originals.SpeechSynthesisUtterance = globalThis.SpeechSynthesisUtterance;
  });

  afterEach(() => {
    globalThis.SpeechRecognition = originals.SpeechRecognition;
    globalThis.webkitSpeechRecognition = originals.webkitSpeechRecognition;
    globalThis.speechSynthesis = originals.speechSynthesis;
    globalThis.SpeechSynthesisUtterance = originals.SpeechSynthesisUtterance;
  });

  it('reports both stt and tts when present', () => {
    globalThis.SpeechRecognition = class {};
    globalThis.speechSynthesis = { getVoices: () => [] };
    globalThis.SpeechSynthesisUtterance = class {};
    const out = detectVoiceSupport();
    expect(out.stt).toBe(true);
    expect(out.tts).toBe(true);
    expect(out.onDevice).toBe(false);
    expect(out.reasons).toEqual([]);
  });

  it('detects on-device support when SpeechRecognition.install is present', () => {
    class SR {}
    SR.install = () => {};
    globalThis.SpeechRecognition = SR;
    globalThis.speechSynthesis = { getVoices: () => [] };
    globalThis.SpeechSynthesisUtterance = class {};
    expect(detectVoiceSupport().onDevice).toBe(true);
  });

  it('reports stt false in environments without SpeechRecognition', () => {
    delete globalThis.SpeechRecognition;
    delete globalThis.webkitSpeechRecognition;
    globalThis.speechSynthesis = { getVoices: () => [] };
    globalThis.SpeechSynthesisUtterance = class {};
    const out = detectVoiceSupport();
    expect(out.stt).toBe(false);
    expect(out.reasons.length).toBeGreaterThan(0);
    expect(out.reasons[0].toLowerCase()).toContain('chrome');
  });

  it('accepts webkit-prefixed SpeechRecognition', () => {
    delete globalThis.SpeechRecognition;
    globalThis.webkitSpeechRecognition = class {};
    globalThis.speechSynthesis = { getVoices: () => [] };
    globalThis.SpeechSynthesisUtterance = class {};
    expect(detectVoiceSupport().stt).toBe(true);
  });

  it('reports tts false when speechSynthesis or utterance is missing', () => {
    globalThis.SpeechRecognition = class {};
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
    expect(detectVoiceSupport().tts).toBe(false);
  });
});
