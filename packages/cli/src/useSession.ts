import { useCallback, useRef, useState } from 'react';
import type { InvokeEvent } from '@hover-dev/core';
import type { Phase, StreamLine } from './app.js';
import { createEventMapper, nextLineId } from './engine/events.js';
import type { Runner } from './engine/driver.js';

/* Owns the live run: drives a {@link Runner}, maps its event stream into
 * `StreamLine`s, and tracks the coarse `phase` + busy flag the UI renders. The
 * runner is injected (real one in the entry, a fake in tests), so this hook —
 * and the whole App — is testable without spawning an agent. */

export interface UseSessionOptions {
  runner?: Runner;
  initialLines?: StreamLine[];
  initialPhase?: Phase;
}

export interface SessionState {
  lines: StreamLine[];
  phase: Phase;
  busy: boolean;
  /** Kick off a run with the given goal (no-op while busy). */
  start: (goal: string) => void;
  /** Abort the current run, if any. */
  cancel: () => void;
}

export function useSession(opts: UseSessionOptions = {}): SessionState {
  const [lines, setLines] = useState<StreamLine[]>(opts.initialLines ?? []);
  const [phase, setPhase] = useState<Phase>(opts.initialPhase ?? 'idle');
  const [busy, setBusy] = useState(false);
  const mapRef = useRef(createEventMapper());
  const abortRef = useRef<AbortController | null>(null);

  const append = useCallback((line: StreamLine) => {
    setLines((ls) => [...ls, line]);
  }, []);

  const start = useCallback(
    (goal: string) => {
      const text = goal.trim();
      if (!text || busy) return;
      append({ id: nextLineId(), kind: 'user', text });

      const runner = opts.runner;
      if (!runner) {
        append({ id: nextLineId(), kind: 'info', text: '(no engine wired — run `hover` in a project)' });
        return;
      }

      setBusy(true);
      setPhase('exploring');
      const ac = new AbortController();
      abortRef.current = ac;

      const onEvent = (ev: InvokeEvent) => {
        const line = mapRef.current(ev);
        if (line) append(line);
      };

      runner(text, onEvent, ac.signal)
        .then((res) => setPhase(res.isError ? 'idle' : 'done'))
        .catch((err: unknown) => {
          append({ id: nextLineId(), kind: 'error', text: err instanceof Error ? err.message : String(err) });
          setPhase('idle');
        })
        .finally(() => {
          setBusy(false);
          abortRef.current = null;
        });
    },
    [busy, opts.runner, append],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { lines, phase, busy, start, cancel };
}
