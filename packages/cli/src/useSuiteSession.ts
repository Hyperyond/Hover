import { useCallback, useReducer, useRef, useState } from 'react';
import type { InvokeEvent } from '@hover-dev/core';
import type { StreamLine } from './app.js';
import { createEventMapper, nextLineId } from './engine/events.js';
import type { AskAnswer, AskRequest, Candidate, Fact } from './engine/backchannel.js';
import {
  initialSuiteState,
  selectedItems,
  suiteReducer,
  type SuiteCandidate,
  type SuiteState,
} from './suiteModel.js';

/*
 * The autonomous flow controller: explore → propose → generate (→ verify in
 * stage 5). It owns the run stream + suite state and drives an injected
 * {@link SuiteEngine}; the engine hides Chrome / the agent / the back-channel,
 * so this hook (and the whole App) is testable with a fake.
 */

export interface ExploreArgs {
  goal: string;
  onEvent: (ev: InvokeEvent) => void;
  onCandidate: (c: Candidate) => void;
  onFact: (f: Fact) => void;
  onAsk: (req: AskRequest) => Promise<AskAnswer>;
  signal: AbortSignal;
}

export interface VerifyResult {
  ok: boolean;
  failures?: { tool: string; error: string }[];
}

export interface SuiteEngine {
  /** Run exploration to discover candidate flows. Resolves when it ends. */
  explore(args: ExploreArgs): Promise<{ isError: boolean }>;
  /** Crystallize one chosen candidate → the written spec path. */
  crystallize(candidate: SuiteCandidate): Promise<{ path: string }>;
  /** Replay the flow's grounded steps over CDP to confirm it still passes.
   *  Optional — when absent, a generated spec is left unverified. */
  verify?(candidate: SuiteCandidate): Promise<VerifyResult>;
}

export interface PendingAsk {
  req: AskRequest;
  resolve: (answer: AskAnswer) => void;
}

export interface SuiteSession {
  state: SuiteState;
  lines: StreamLine[];
  busy: boolean;
  pendingAsk: PendingAsk | null;
  /** Begin exploration (no-op while busy). */
  start: (goal: string) => void;
  toggle: (id: string) => void;
  selectAll: (value: boolean) => void;
  /** Crystallize the selected flows. */
  confirm: () => void;
  /** Skip the proposing phase without generating anything. */
  skip: () => void;
  /** Answer the open ask prompt (`null` = dismiss). */
  answerAsk: (value: string | null) => void;
  cancel: () => void;
}

export interface UseSuiteSessionOptions {
  engine?: SuiteEngine;
  initialState?: SuiteState;
  initialLines?: StreamLine[];
}

export function useSuiteSession(opts: UseSuiteSessionOptions = {}): SuiteSession {
  const [state, dispatch] = useReducer(suiteReducer, opts.initialState ?? initialSuiteState);
  const [lines, setLines] = useState<StreamLine[]>(opts.initialLines ?? []);
  const [busy, setBusy] = useState(false);
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
  const mapRef = useRef(createEventMapper());
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const append = useCallback((line: StreamLine) => setLines((ls) => [...ls, line]), []);

  const start = useCallback(
    (goal: string) => {
      const engine = opts.engine;
      if (busy) return;
      append({ id: nextLineId(), kind: 'user', text: goal.trim() || 'Explore the whole app.' });
      if (!engine) {
        append({ id: nextLineId(), kind: 'info', text: '(no engine wired — run `hover` in a project)' });
        return;
      }
      setBusy(true);
      dispatch({ type: 'explore-start' });
      const ac = new AbortController();
      abortRef.current = ac;

      engine
        .explore({
          goal,
          signal: ac.signal,
          onEvent: (ev) => {
            const line = mapRef.current(ev);
            if (line) append(line);
          },
          onCandidate: (c) => dispatch({ type: 'candidate', candidate: c }),
          onFact: (f) => append({ id: nextLineId(), kind: 'info', text: `remembered: ${f.title}` }),
          onAsk: (req) =>
            new Promise<AskAnswer>((resolve) => {
              setPendingAsk({ req, resolve });
            }),
        })
        .catch((err: unknown) => {
          append({ id: nextLineId(), kind: 'error', text: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          dispatch({ type: 'explore-done' });
          setBusy(false);
          setPendingAsk(null);
          abortRef.current = null;
        });
    },
    [busy, opts.engine, append],
  );

  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const selectAll = useCallback((value: boolean) => dispatch({ type: 'select-all', value }), []);

  const confirm = useCallback(() => {
    const engine = opts.engine;
    const chosen = selectedItems(stateRef.current);
    if (busy || !engine || chosen.length === 0) return;
    setBusy(true);
    dispatch({ type: 'generate-start' });

    (async () => {
      for (const item of chosen) {
        dispatch({ type: 'generating', id: item.id });
        try {
          const { path } = await engine.crystallize(item);
          dispatch({ type: 'generated', id: item.id, path });
          append({ id: nextLineId(), kind: 'info', text: `✓ wrote ${path.split(/[\\/]/).pop()}` });
        } catch (err) {
          dispatch({ type: 'verified', id: item.id, ok: false, note: 'generate failed' });
          append({ id: nextLineId(), kind: 'error', text: err instanceof Error ? err.message : String(err) });
          continue; // nothing to verify if it didn't write
        }
        // Self-verify: replay the grounded steps in the debug Chrome.
        if (engine.verify) {
          dispatch({ type: 'verifying', id: item.id });
          try {
            const v = await engine.verify(item);
            const why = v.failures?.[0]?.error;
            dispatch({ type: 'verified', id: item.id, ok: v.ok, note: v.ok ? 'verified' : why ?? 'replay failed' });
            append({
              id: nextLineId(),
              kind: v.ok ? 'info' : 'error',
              text: v.ok ? `✓ ${item.name} replays` : `✗ ${item.name} failed replay${why ? `: ${why}` : ''}`,
            });
          } catch (err) {
            dispatch({ type: 'verified', id: item.id, ok: false, note: 'verify error' });
            append({ id: nextLineId(), kind: 'error', text: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      dispatch({ type: 'done' });
      setBusy(false);
    })();
  }, [busy, opts.engine, append]);

  const skip = useCallback(() => dispatch({ type: 'done' }), []);

  const answerAsk = useCallback((value: string | null) => {
    setPendingAsk((pa) => {
      if (pa) pa.resolve(value === null ? { cancelled: true } : { value });
      return null;
    });
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { state, lines, busy, pendingAsk, start, toggle, selectAll, confirm, skip, answerAsk, cancel };
}
