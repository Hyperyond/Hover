import { describe, test, expect } from 'vitest';
import { parseVerdict, classifyInstruction } from '../../src/qa/classify.js';

describe('parseVerdict', () => {
  test('bare JSON: go', () => {
    expect(parseVerdict('{"route":"go"}')).toEqual({ route: 'go', refinedInstruction: undefined });
  });

  test('go carries a refined instruction', () => {
    const v = parseVerdict('{"route":"go","refinedInstruction":"Test this page thoroughly."}');
    expect(v.route).toBe('go');
    expect(v.refinedInstruction).toBe('Test this page thoroughly.');
  });

  test('clarify with >=2 options', () => {
    const v = parseVerdict('{"route":"clarify","reason":"What should I test?","options":["Test login","Test checkout"]}');
    expect(v.route).toBe('clarify');
    expect(v.reason).toBe('What should I test?');
    expect(v.options).toEqual(['Test login', 'Test checkout']);
  });

  test('clarify with <2 options downgrades to go (cannot render usefully)', () => {
    expect(parseVerdict('{"route":"clarify","options":["only one"]}').route).toBe('go');
    expect(parseVerdict('{"route":"clarify","options":[]}').route).toBe('go');
    expect(parseVerdict('{"route":"clarify"}').route).toBe('go');
  });

  test('clarify dedupes + caps options at 4', () => {
    const v = parseVerdict('{"route":"clarify","options":["a","a","b","c","d","e"]}');
    expect(v.options).toEqual(['a', 'b', 'c', 'd']);
  });

  test('refuse carries a reason', () => {
    const v = parseVerdict('{"route":"refuse","reason":"I only test this app."}');
    expect(v).toEqual({ route: 'refuse', reason: 'I only test this app.' });
  });

  test('tolerates a ```json fence', () => {
    expect(parseVerdict('```json\n{"route":"refuse","reason":"no"}\n```').route).toBe('refuse');
  });

  test('tolerates JSON embedded in prose', () => {
    expect(parseVerdict('Here is my verdict: {"route":"go"} — done.').route).toBe('go');
  });

  test('fail-open → go on garbage / empty / no-JSON', () => {
    expect(parseVerdict('').route).toBe('go');
    expect(parseVerdict('   ').route).toBe('go');
    expect(parseVerdict('not json at all').route).toBe('go');
    expect(parseVerdict('{not valid json}').route).toBe('go');
  });

  test('unknown route → go', () => {
    expect(parseVerdict('{"route":"explode"}').route).toBe('go');
  });
});

describe('classifyInstruction (fail-open)', () => {
  test('an invalid agent id resolves to go rather than throwing', async () => {
    const v = await classifyInstruction({ agentId: '__nonexistent_agent__', instruction: 'test the login flow' });
    expect(v).toEqual({ route: 'go' });
  });
});
