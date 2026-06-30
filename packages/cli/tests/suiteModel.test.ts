import { describe, expect, it } from 'vitest';
import {
  suiteReducer,
  initialSuiteState,
  selectedCount,
  selectedItems,
  type SuiteAction,
  type SuiteState,
} from '../src/suiteModel.js';

const run = (actions: SuiteAction[], start: SuiteState = initialSuiteState): SuiteState =>
  actions.reduce(suiteReducer, start);

const cand = (name: string, steps = 1) => ({
  type: 'candidate' as const,
  candidate: { name, steps: Array.from({ length: steps }, () => ({ kind: 'step' as const, tool: 't' })) },
});

describe('suiteReducer', () => {
  it('collects candidates during exploration, pre-selected', () => {
    const s = run([{ type: 'explore-start' }, cand('Log in'), cand('Add to cart')]);
    expect(s.phase).toBe('exploring');
    expect(s.items.map((i) => i.name)).toEqual(['Log in', 'Add to cart']);
    expect(s.items.every((i) => i.selected && i.status === 'queued')).toBe(true);
    expect(s.items.map((i) => i.id)).toEqual(['log-in', 'add-to-cart']);
  });

  it('dedupes a re-recorded flow by name, updating its steps', () => {
    const s = run([{ type: 'explore-start' }, cand('Log in', 1), cand('Log in', 3)]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].steps).toHaveLength(3);
  });

  it('disambiguates distinct flows that slug to the same id', () => {
    const s = run([{ type: 'explore-start' }, cand('Log in'), { type: 'candidate', candidate: { name: 'Log  in!', steps: [] } }]);
    // Different names ("Log in" vs "Log  in!") but same slug → unique ids.
    expect(s.items.map((i) => i.id)).toEqual(['log-in', 'log-in-2']);
  });

  it('explore-done → proposing when there are items, done when empty', () => {
    expect(run([{ type: 'explore-start' }, { type: 'explore-done' }]).phase).toBe('done');
    expect(run([{ type: 'explore-start' }, cand('X'), { type: 'explore-done' }]).phase).toBe('proposing');
  });

  it('toggles selection and select-all', () => {
    let s = run([{ type: 'explore-start' }, cand('A'), cand('B'), { type: 'explore-done' }]);
    expect(selectedCount(s)).toBe(2);
    s = suiteReducer(s, { type: 'toggle', id: 'a' });
    expect(selectedCount(s)).toBe(1);
    s = suiteReducer(s, { type: 'select-all', value: false });
    expect(selectedCount(s)).toBe(0);
    s = suiteReducer(s, { type: 'select-all', value: true });
    expect(selectedCount(s)).toBe(2);
  });

  it('generate-start drops unselected flows and moves to generating', () => {
    let s = run([{ type: 'explore-start' }, cand('A'), cand('B'), cand('C'), { type: 'explore-done' }]);
    s = suiteReducer(s, { type: 'toggle', id: 'b' }); // deselect B
    s = suiteReducer(s, { type: 'generate-start' });
    expect(s.phase).toBe('generating');
    expect(s.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(selectedItems(s)).toHaveLength(2);
  });

  it('tracks per-item generate → verify lifecycle', () => {
    let s = run([{ type: 'explore-start' }, cand('Log in'), { type: 'explore-done' }, { type: 'generate-start' }]);
    s = suiteReducer(s, { type: 'generating', id: 'log-in' });
    expect(s.items[0]).toMatchObject({ status: 'active', note: 'generating…' });
    s = suiteReducer(s, { type: 'generated', id: 'log-in', path: '/p/__vibe_tests__/log-in.spec.ts' });
    expect(s.items[0]).toMatchObject({ status: 'pass', note: 'log-in.spec.ts', path: '/p/__vibe_tests__/log-in.spec.ts' });
    s = suiteReducer(s, { type: 'verifying', id: 'log-in' });
    expect(s.phase).toBe('verifying');
    expect(s.items[0]).toMatchObject({ status: 'active', note: 'verifying…' });
    s = suiteReducer(s, { type: 'verified', id: 'log-in', ok: false });
    expect(s.items[0]).toMatchObject({ status: 'fail', note: 'replay failed' });
  });

  it('reset clears everything', () => {
    const s = run([{ type: 'explore-start' }, cand('A')]);
    expect(suiteReducer(s, { type: 'reset' })).toEqual(initialSuiteState);
  });
});
