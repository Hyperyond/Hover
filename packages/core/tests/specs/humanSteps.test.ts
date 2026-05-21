import { describe, it, expect } from 'vitest';
import { humanStep, humanSteps } from '../../src/specs/humanSteps.js';
import type { SkillStep } from '../../src/skills/writeSkill.js';

describe('humanStep', () => {
  it('translates browser_navigate to Open <url>', () => {
    expect(humanStep('browser_navigate', { url: 'http://localhost:5173/' }))
      .toBe('Open http://localhost:5173/');
  });

  it('translates browser_click to Click <element>', () => {
    expect(humanStep('browser_click', { element: 'Submit button' }))
      .toBe('Click Submit button');
  });

  it('translates browser_type to Type "<text>" into <element>', () => {
    expect(humanStep('browser_type', { element: 'Email textbox', text: 'a@b.co' }))
      .toBe('Type "a@b.co" into Email textbox');
  });

  it('translates browser_fill_form into one joined sentence per call', () => {
    const result = humanStep('browser_fill_form', {
      fields: [
        { name: 'Email', value: 'a@b.co' },
        { name: 'Password', value: 'pw' },
      ],
    });
    expect(result).toBe('Fill Email="a@b.co", Password="pw"');
  });

  it('translates browser_select_option to Select "<value>" in <element>', () => {
    expect(humanStep('browser_select_option', { element: 'State', values: ['CA'] }))
      .toBe('Select "CA" in State');
  });

  it('translates browser_press_key to Press <key>', () => {
    expect(humanStep('browser_press_key', { key: 'Enter' })).toBe('Press Enter');
  });

  it('returns null for diagnostic tools (browser_snapshot)', () => {
    expect(humanStep('browser_snapshot', {})).toBeNull();
  });

  it('returns null for unknown tools', () => {
    expect(humanStep('browser_teleport', { destination: 'mars' })).toBeNull();
  });

  it('escapes embedded double-quotes inside typed text', () => {
    expect(humanStep('browser_type', { element: 'comment', text: 'she said "hi"' }))
      .toBe('Type "she said \\"hi\\"" into comment');
  });
});

describe('humanSteps (full session)', () => {
  it('returns an empty array for sessions with no replayable tool calls', () => {
    const steps: SkillStep[] = [
      { kind: 'user', text: 'just talk' },
      { kind: 'ai', text: 'no actions needed' },
      { kind: 'step', tool: 'browser_snapshot', input: {} }, // diagnostic, skipped
    ];
    expect(humanSteps(steps)).toEqual([]);
  });

  it('produces one line per replayable step in order', () => {
    const steps: SkillStep[] = [
      { kind: 'user', text: 'login' },
      { kind: 'step', tool: 'browser_navigate', input: { url: 'http://app/' } },
      { kind: 'step', tool: 'browser_type', input: { element: 'Email', text: 'a@b' } },
      { kind: 'step', tool: 'browser_click', input: { element: 'Submit' } },
    ];
    expect(humanSteps(steps)).toEqual([
      'Open http://app/',
      'Type "a@b" into Email',
      'Click Submit',
    ]);
  });

  it('collapses N consecutive identical sentences into "(× N)"', () => {
    const steps: SkillStep[] = [
      { kind: 'step', tool: 'browser_click', input: { element: '+ 1 button' } },
      { kind: 'step', tool: 'browser_click', input: { element: '+ 1 button' } },
      { kind: 'step', tool: 'browser_click', input: { element: '+ 1 button' } },
      { kind: 'step', tool: 'browser_click', input: { element: 'Submit' } },
    ];
    expect(humanSteps(steps)).toEqual([
      'Click + 1 button (× 3)',
      'Click Submit',
    ]);
  });

  it('skips diagnostic steps without affecting the collapse counter', () => {
    const steps: SkillStep[] = [
      { kind: 'step', tool: 'browser_click', input: { element: 'X' } },
      { kind: 'step', tool: 'browser_snapshot', input: {} },
      { kind: 'step', tool: 'browser_click', input: { element: 'X' } },
    ];
    // The intervening snapshot is dropped — collapse still works because
    // the produced sentence list goes "Click X, Click X" -> "Click X (× 2)".
    expect(humanSteps(steps)).toEqual(['Click X (× 2)']);
  });
});
