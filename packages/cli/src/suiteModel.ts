import type { SkillStep } from '@hover-dev/core/engine';
import type { Phase, SuiteStatus } from './app.js';

/*
 * The autonomous flow's suite/phase state, as a PURE reducer (no React, no I/O)
 * so the orchestration is fully unit-testable. The hook dispatches actions from
 * back-channel events (candidate/fact), the explore run lifecycle, the pick
 * keystrokes, and crystallize/verify results.
 *
 *   idle → exploring → proposing → generating → verifying → done
 */

export interface SuiteCandidate {
  id: string;
  name: string;
  description?: string;
  /** Grounded steps captured during exploration — ready for writeSpec. */
  steps: SkillStep[];
  status: SuiteStatus;
  /** Checked for crystallization in the proposing phase. */
  selected: boolean;
  note?: string;
  /** Written spec path, once crystallized. */
  path?: string;
}

export interface SuiteState {
  phase: Phase;
  items: SuiteCandidate[];
}

export const initialSuiteState: SuiteState = { phase: 'idle', items: [] };

export type SuiteAction =
  | { type: 'reset' }
  | { type: 'explore-start' }
  | { type: 'candidate'; candidate: { name: string; description?: string; steps: SkillStep[] } }
  | { type: 'explore-done' }
  | { type: 'toggle'; id: string }
  | { type: 'select-all'; value: boolean }
  | { type: 'generate-start' }
  | { type: 'generating'; id: string }
  | { type: 'generated'; id: string; path: string }
  | { type: 'verifying'; id: string }
  | { type: 'verified'; id: string; ok: boolean; note?: string }
  | { type: 'done' };

/** kebab-case slug for a stable-ish candidate id. */
function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow'
  );
}

const setItem = (items: SuiteCandidate[], id: string, patch: Partial<SuiteCandidate>): SuiteCandidate[] =>
  items.map((it) => (it.id === id ? { ...it, ...patch } : it));

export function suiteReducer(state: SuiteState, action: SuiteAction): SuiteState {
  switch (action.type) {
    case 'reset':
      return initialSuiteState;

    case 'explore-start':
      return { phase: 'exploring', items: [] };

    case 'candidate': {
      const { name, description, steps } = action.candidate;
      // Dedup by name — a re-recorded flow updates its steps rather than dupes.
      const existing = state.items.find((it) => it.name === name);
      if (existing) {
        return { ...state, items: setItem(state.items, existing.id, { description, steps }) };
      }
      const base = slug(name);
      let id = base;
      let n = 2;
      while (state.items.some((it) => it.id === id)) id = `${base}-${n++}`;
      const item: SuiteCandidate = { id, name, description, steps, status: 'queued', selected: true, note: 'found' };
      return { ...state, items: [...state.items, item] };
    }

    case 'explore-done':
      // Nothing discovered → straight to done; otherwise let the user pick.
      return { ...state, phase: state.items.length ? 'proposing' : 'done' };

    case 'toggle':
      return { ...state, items: setItem(state.items, action.id, invertSelected(state.items, action.id)) };

    case 'select-all':
      return { ...state, items: state.items.map((it) => ({ ...it, selected: action.value })) };

    case 'generate-start':
      // Keep only the chosen flows; they become the suite.
      return {
        phase: 'generating',
        items: state.items.filter((it) => it.selected).map((it) => ({ ...it, note: 'queued' })),
      };

    case 'generating':
      return { ...state, items: setItem(state.items, action.id, { status: 'active', note: 'generating…' }) };

    case 'generated':
      return {
        ...state,
        items: setItem(state.items, action.id, { status: 'pass', path: action.path, note: basename(action.path) }),
      };

    case 'verifying':
      return { ...state, phase: 'verifying', items: setItem(state.items, action.id, { status: 'active', note: 'verifying…' }) };

    case 'verified':
      return {
        ...state,
        items: setItem(state.items, action.id, {
          status: action.ok ? 'pass' : 'fail',
          note: action.note ?? (action.ok ? 'verified' : 'replay failed'),
        }),
      };

    case 'done':
      return { ...state, phase: 'done' };

    default:
      return state;
  }
}

function invertSelected(items: SuiteCandidate[], id: string): Partial<SuiteCandidate> {
  const it = items.find((i) => i.id === id);
  return { selected: !(it?.selected ?? false) };
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

// ── selectors ────────────────────────────────────────────────────────────────
export const selectedCount = (s: SuiteState): number => s.items.filter((it) => it.selected).length;
export const selectedItems = (s: SuiteState): SuiteCandidate[] => s.items.filter((it) => it.selected);
