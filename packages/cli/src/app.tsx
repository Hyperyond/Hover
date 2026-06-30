import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { useSuiteSession, type SuiteEngine } from './useSuiteSession.js';
import type { SuiteCandidate, SuiteState } from './suiteModel.js';
import { selectedCount } from './suiteModel.js';

/*
 * Hover CLI — direction C, autonomous suite authoring.
 *
 *   ┌ Hover · exploring the app ───────── claude · sonnet · localhost:5173 ┐
 *   │ run stream (narration + grounded tool steps) │ SUITE / PICK FLOWS    │
 *   │  ▸ exploring…                                │ [x] Log in            │
 *   │  · click "Sign in"                           │ [x] Add to cart       │
 *   ├──────────────────────────────────────────────┴──────────────────────┤
 *   │ › goal…   /   ↑↓ pick · space toggle · enter generate   /   ◐ working │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * The view; all logic is in useSuiteSession + the pure suiteReducer. Input is
 * routed by phase: type a goal (idle/done) → explore → PICK the discovered flows
 * → generate. An ask_user from the agent overlays a prompt over everything.
 */

// ── data model (shared with the engine layer) ────────────────────────────────

export type LineKind = 'narration' | 'tool' | 'info' | 'user' | 'error';
export interface StreamLine {
  id: number;
  kind: LineKind;
  text: string;
}

export type SuiteStatus = 'queued' | 'active' | 'pass' | 'fail';

export type Phase = 'idle' | 'exploring' | 'mapping' | 'proposing' | 'generating' | 'verifying' | 'done';

export interface SessionMeta {
  agent: string;
  model: string;
  target: string;
}

// ── styling helpers ──────────────────────────────────────────────────────────

const ACCENT = 'green';
const SUITE_WIDTH = 36;

function lineColor(kind: LineKind): { color?: string; dim?: boolean; bold?: boolean } {
  switch (kind) {
    case 'narration':
      return { color: 'white', bold: true };
    case 'tool':
      return { dim: true };
    case 'info':
      return { color: 'cyan' };
    case 'user':
      return { color: ACCENT };
    case 'error':
      return { color: 'red' };
  }
}

const STATUS_GLYPH: Record<SuiteStatus, { glyph: string; color: string }> = {
  queued: { glyph: '○', color: 'gray' },
  active: { glyph: '◐', color: 'yellow' },
  pass: { glyph: '✓', color: 'green' },
  fail: { glyph: '✗', color: 'red' },
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'ready',
  exploring: 'exploring the app',
  mapping: 'building the business map',
  proposing: 'pick flows to keep',
  generating: 'generating specs',
  verifying: 'self-verifying',
  done: 'done',
};

// ── views ────────────────────────────────────────────────────────────────────

function Header({ meta, phase }: { meta: SessionMeta; phase: Phase }) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        <Text color={ACCENT} bold>
          ✦ Hover
        </Text>
        <Text dimColor>  ·  {PHASE_LABEL[phase]}</Text>
      </Text>
      <Text dimColor>
        {meta.agent} · {meta.model} · {meta.target}
      </Text>
    </Box>
  );
}

function RunStream({ lines }: { lines: StreamLine[] }) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {lines.length === 0 ? (
        <Text dimColor>Press enter to explore the app, or type a goal first.</Text>
      ) : (
        lines.map((l) => {
          const c = lineColor(l.kind);
          const prefix = l.kind === 'user' ? '› ' : l.kind === 'tool' ? '· ' : l.kind === 'narration' ? '▸ ' : '  ';
          return (
            <Text key={l.id} color={c.color} dimColor={c.dim} bold={c.bold} wrap="truncate-end">
              {prefix}
              {l.text}
            </Text>
          );
        })
      )}
    </Box>
  );
}

function SuitePanel({ state, cursor, picking }: { state: SuiteState; cursor: number; picking: boolean }) {
  const items = state.items;
  const title = picking
    ? `PICK FLOWS · ${selectedCount(state)}/${items.length}`
    : `SUITE${items.length ? ` · ${items.filter((i) => i.status === 'pass').length}/${items.length}` : ''}`;

  return (
    <Box flexDirection="column" width={SUITE_WIDTH} borderStyle="round" borderColor={picking ? ACCENT : 'gray'} paddingX={1} overflow="hidden">
      <Text bold dimColor>
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {items.length === 0 ? (
          <Text dimColor>{state.phase === 'exploring' ? 'discovering flows…' : 'No flows yet.'}</Text>
        ) : (
          items.map((it, i) => <SuiteRow key={it.id} item={it} focused={picking && i === cursor} picking={picking} />)
        )}
      </Box>
    </Box>
  );
}

function SuiteRow({ item, focused, picking }: { item: SuiteCandidate; focused: boolean; picking: boolean }) {
  if (picking) {
    return (
      <Text wrap="truncate-end" color={focused ? ACCENT : undefined}>
        {focused ? '› ' : '  '}
        <Text color={item.selected ? ACCENT : 'gray'}>{item.selected ? '[x]' : '[ ]'} </Text>
        {item.name}
      </Text>
    );
  }
  const g = STATUS_GLYPH[item.status];
  return (
    <Text wrap="truncate-end">
      <Text color={g.color}>{g.glyph} </Text>
      <Text color={item.status === 'fail' ? 'red' : undefined}>{item.name}</Text>
      {item.note ? <Text dimColor>  {item.note}</Text> : null}
    </Text>
  );
}

function AskOverlay({ question, options, value }: { question: string; options: { label: string }[]; value: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text color="magenta" bold>
        ? {question}
      </Text>
      {options.map((o, i) => (
        <Text key={i}>
          <Text color="magenta">{i + 1}</Text> {o.label}
        </Text>
      ))}
      <Box>
        <Text color="magenta">› </Text>
        <Text>{value}</Text>
        <Text color="magenta">▏</Text>
      </Box>
    </Box>
  );
}

function Footer({
  mode,
  input,
  active,
  selected,
}: {
  mode: 'typing' | 'busy' | 'picking' | 'ask';
  input: string;
  active: boolean;
  selected: number;
}) {
  if (!active) {
    return (
      <Box paddingX={1}>
        <Text dimColor>input unavailable (no TTY)</Text>
      </Box>
    );
  }
  if (mode === 'ask') {
    return (
      <Box paddingX={1}>
        <Text dimColor>1–9 pick · type a custom answer · enter send · esc dismiss</Text>
      </Box>
    );
  }
  if (mode === 'busy') {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">◐ working… </Text>
        </Box>
        <Box paddingX={1}>
          <Text dimColor>ctrl+c to cancel</Text>
        </Box>
      </Box>
    );
  }
  if (mode === 'picking') {
    return (
      <Box paddingX={1}>
        <Text dimColor>↑↓ move · space toggle · a all · </Text>
        <Text color={ACCENT}>enter generate {selected} flow{selected === 1 ? '' : 's'}</Text>
        <Text dimColor> · esc skip</Text>
      </Box>
    );
  }
  // typing
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={ACCENT} paddingX={1}>
        <Text color={ACCENT}>› </Text>
        <Text>{input}</Text>
        <Text color={ACCENT}>▏</Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>enter to explore · ctrl+c to quit</Text>
      </Box>
    </Box>
  );
}

// ── app ──────────────────────────────────────────────────────────────────────

export interface AppProps {
  meta: SessionMeta;
  /** The engine binding. Omitted in tests / the bare skeleton. */
  engine?: SuiteEngine;
  /** Seed state for tests / the skeleton. */
  initialState?: SuiteState;
  initialLines?: StreamLine[];
}

export function App({ meta, engine, initialState, initialLines }: AppProps) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const s = useSuiteSession({ engine, initialState, initialLines });
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [askInput, setAskInput] = useState('');

  const { phase, items } = s.state;
  const asking = !!s.pendingAsk;
  const picking = phase === 'proposing' && !asking;
  const typing = (phase === 'idle' || phase === 'done') && !asking && !s.busy;

  // Keep the pick cursor in range as items appear / are dropped.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  useInput(
    (ch, key) => {
      if (key.ctrl && ch === 'c') {
        if (s.busy) s.cancel();
        else exit();
        return;
      }

      if (asking) {
        const opts = s.pendingAsk!.req.options;
        if (key.escape) {
          s.answerAsk(null);
          setAskInput('');
        } else if (key.return) {
          s.answerAsk(askInput.trim() || null);
          setAskInput('');
        } else if (/^[1-9]$/.test(ch) && opts[Number(ch) - 1]) {
          s.answerAsk(opts[Number(ch) - 1].label);
          setAskInput('');
        } else if (key.backspace || key.delete) {
          setAskInput((v) => v.slice(0, -1));
        } else if (ch && !key.ctrl && !key.meta) {
          setAskInput((v) => v + ch);
        }
        return;
      }

      if (picking) {
        if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
        else if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1));
        else if (ch === ' ') items[cursor] && s.toggle(items[cursor].id);
        else if (ch === 'a' || ch === 'A') s.selectAll(!items.every((i) => i.selected));
        else if (key.return) s.confirm();
        else if (key.escape) s.skip();
        return;
      }

      if (typing) {
        if (key.return) {
          s.start(input);
          setInput('');
        } else if (key.backspace || key.delete) {
          setInput((v) => v.slice(0, -1));
        } else if (ch && !key.ctrl && !key.meta) {
          setInput((v) => v + ch);
        }
        return;
      }
      // busy phases (exploring / generating / verifying): ignore other keys.
    },
    { isActive: !!isRawModeSupported },
  );

  const height = Math.max(8, (stdout?.rows ?? 24) - 1);
  const mode: 'typing' | 'busy' | 'picking' | 'ask' = asking ? 'ask' : picking ? 'picking' : s.busy ? 'busy' : 'typing';

  return (
    <Box flexDirection="column" height={height}>
      <Header meta={meta} phase={phase} />
      <Box flexGrow={1} flexDirection="row" overflow="hidden">
        <RunStream lines={s.lines} />
        <SuitePanel state={s.state} cursor={cursor} picking={picking} />
      </Box>
      {asking ? (
        <AskOverlay question={s.pendingAsk!.req.question} options={s.pendingAsk!.req.options} value={askInput} />
      ) : null}
      <Footer mode={mode} input={input} active={!!isRawModeSupported} selected={selectedCount(s.state)} />
    </Box>
  );
}
