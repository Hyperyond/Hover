import { fileURLToPath } from 'node:url';
import React from 'react';
import { render } from 'ink';
import { pickPrimaryAgent } from '@hover-dev/core';
import { asQaIntensity } from '@hover-dev/core/engine';
import { App, type SessionMeta } from './app.js';
import { startBackchannel } from './engine/backchannel.js';
import { makeSuiteEngine } from './engine/suiteEngine.js';
import { runInit } from './init.js';

// ── tiny arg/env reads ───────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ── `hover init` — scaffold Hover into the user's project for their own agent
// (Claude Code). Runs before the TTY guard so it works piped / in scripts.
if (process.argv[2] === 'init') {
  const target = arg('--target') ?? process.env.HOVER_TARGET ?? 'http://localhost:5173';
  const mcpJs = fileURLToPath(new URL('./mcp.js', import.meta.url));
  const res = runInit({ cwd: process.cwd(), target, mcpCommand: process.execPath, mcpArgs: [mcpJs] });
  process.stdout.write(
    `✦ Hover initialized for Claude Code:\n` +
      res.files.map((f) => `  ✓ ${f}`).join('\n') +
      `\n\nTarget: ${target}  (edit HOVER_TARGET in .mcp.json to change)\n` +
      `Next: open this folder in Claude Code → run /hover (or "test my app with hover").\n`,
  );
  process.exit(0);
}

// The TUI needs an interactive terminal — ink puts stdin into raw mode for
// keystroke handling, which a pipe / redirect can't support. Fail clearly
// instead of crashing deep inside the reconciler. (A non-interactive
// `--headless` run mode is a later stage; it won't mount this component.)
if (!process.stdin.isTTY) {
  process.stderr.write('Hover CLI needs an interactive terminal (TTY). Run `hover` directly in your terminal.\n');
  process.exit(1);
}

const target = arg('--target') ?? process.env.HOVER_TARGET ?? 'http://localhost:5173';
const model = arg('--model') ?? process.env.HOVER_MODEL ?? 'sonnet';
const intensity = asQaIntensity(arg('--intensity') ?? process.env.HOVER_INTENSITY);
const devRoot = process.cwd();

// Detect the user's coding-agent CLI up front so the header reflects it (the run
// itself re-resolves it). null → header shows "none"; the first run surfaces a
// clear install hint.
const detected = await pickPrimaryAgent(process.env.HOVER_AGENT);

// The control back-channel: receives record-candidate / record-fact and routes
// ask_user to the UI. Lives for the whole session; handlers swap per run.
const bc = await startBackchannel();
const engine = makeSuiteEngine(
  { target, devRoot, agentId: detected?.descriptor.id, model, intensity },
  bc,
);

const meta: SessionMeta = {
  agent: detected?.descriptor.id ?? 'none',
  model,
  target: target.replace(/^https?:\/\//, ''),
};

const { waitUntilExit } = render(<App meta={meta} engine={engine} />);
await waitUntilExit();
await bc.close();
