/**
 * `hover run "<prompt>"` — CLI-only authoring. Drives the user's debug Chrome
 * through the core `runSession` engine (no widget, no DOM injection), streams
 * the run in a Clack/Claude-style line format, and optionally crystallizes the
 * verified session into a spec with `--save <slug>`.
 *
 * Auto-launches the isolated debug Chrome if none is up (the same persistent
 * profile the widget uses) — first run hits the login wall, later runs reuse
 * the logged-in profile. NOT headless: it drives a real, visible Chrome over
 * CDP, never spawns a throwaway browser or handles auth itself.
 *
 * Dynamically imports the project's installed @hover-dev/core/dist (same trick
 * as optimize / re-record) so the CLI stays a near-zero-dependency binary.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { bold, cyan, dim, err, ok, head, line, sub, gap, done, tail } from './log.js';

export interface RunArgs {
  prompt: string;
  url: string | null;
  save: string | null;
  agent: string | null;
  model: string | null;
  cwd: string | null;
}

/** Walk up from `cwd` to the project's installed `@hover-dev/core/dist`. */
function resolveCoreDist(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    const d = join(dir, 'node_modules', '@hover-dev', 'core', 'dist');
    if (existsSync(join(d, 'runSession.js'))) return d;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function runRun(args: RunArgs): Promise<number> {
  const cwd = args.cwd
    ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
    : process.cwd();
  if (args.cwd && !existsSync(cwd)) {
    err(`--cwd path does not exist: ${cwd}`);
    return 1;
  }

  const coreDist = resolveCoreDist(cwd);
  if (!coreDist) {
    err(`Couldn't find ${cyan('@hover-dev/core')} under ${cyan(cwd)}.`);
    err(`CLI-only mode needs just the engine — no bundler config:`);
    err(`  ${cyan('npm i -D @hover-dev/core')}`);
    return 1;
  }

  const agentId = args.agent ?? process.env.HOVER_AGENT ?? 'claude';
  const model = args.model ?? process.env.HOVER_MODEL ?? 'sonnet';
  const cdpUrl = process.env.HOVER_CDP ?? 'http://localhost:9222';
  let port = 9222;
  try { port = Number(new URL(cdpUrl).port) || 9222; } catch { /* keep default */ }

  const { launchDebugChrome } = (await import(
    `file://${join(coreDist, 'playwright', 'launchChrome.js')}`
  )) as {
    launchDebugChrome: (o: {
      port?: number;
      url?: string;
    }) => Promise<{ ok: boolean; alreadyRunning?: boolean; reason?: string }>;
  };
  const { runSession } = (await import(`file://${join(coreDist, 'runSession.js')}`)) as {
    runSession: (
      o: {
        prompt: string;
        agentId: string;
        cdpUrl: string;
        model?: string;
        cwd?: string;
      },
      onEvent: (ev: RunEvent) => void,
    ) => Promise<{ steps: unknown[]; summary: string; isError: boolean }>;
  };

  head(`${bold('hover run')} ${dim('·')} ${agentId} ${dim('·')} ${model}`);
  gap();

  // 1 · ensure a debug Chrome (auto-launch; idempotent — reuses a live one).
  head('Chrome');
  const launch = await launchDebugChrome({ port, url: args.url ?? undefined });
  if (!launch.ok) {
    err(`couldn't start the debug Chrome: ${launch.reason ?? 'unknown error'}`);
    return 1;
  }
  line(dim(launch.alreadyRunning ? `reusing debug Chrome on :${port}` : `launched debug Chrome on :${port}`));
  if (!args.url) line(dim('tip: pass --url <devUrl> so Chrome opens your app directly'));
  gap();

  // 2 · drive the session, streaming events.
  head(args.prompt);
  let lastCost = '';
  let lastTurns = '';
  const render = (ev: RunEvent): void => {
    if (ev.kind === 'text' && ev.text) line(cyan(ev.text.trim()));
    else if (ev.kind === 'tool_use' && ev.tool) sub(`→ ${ev.tool}`);
    else if (ev.kind === 'usage' || ev.kind === 'session_end') {
      if (ev.costUsd != null) lastCost = `$${ev.costUsd.toFixed(4)}`;
      if (ev.turns != null) lastTurns = `${ev.turns} turn${ev.turns === 1 ? '' : 's'}`;
    }
  };
  const result = await runSession({ prompt: args.prompt, agentId, model, cdpUrl, cwd }, render);

  gap();
  const meta = [lastTurns, lastCost].filter(Boolean).join(' · ');
  done(`${result.isError ? 'Ended with an error' : 'Done'}${meta ? ` ${dim('·')} ${meta}` : ''}`);
  if (result.summary) line(result.summary.trim());

  // 3 · optional crystallize.
  if (args.save) {
    const { writeSpec } = (await import(`file://${join(coreDist, 'specs', 'writeSpec.js')}`)) as {
      writeSpec: (o: {
        devRoot: string;
        name: string;
        steps: unknown[];
        overwrite?: boolean;
      }) => Promise<{ path: string; slug: string }>;
    };
    try {
      const written = await writeSpec({ devRoot: cwd, name: args.save, steps: result.steps });
      gap();
      ok(`saved ${cyan(relative(cwd, written.path))}`);
      tail(`review it, then ${cyan(`hover optimize ${written.slug}`)} to polish · ${dim('runs in CI with no agent')}`);
    } catch (e) {
      err(`save failed: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  } else {
    tail(dim('run again with --save <slug> to crystallize this into a Playwright spec'));
  }

  return result.isError ? 1 : 0;
}

interface RunEvent {
  kind: string;
  text?: string;
  tool?: string;
  costUsd?: number;
  turns?: number;
}

/** Parse `run`'s argv slice: positional <prompt> + --url / --save / --agent / --model / --cwd. */
export function parseRunArgs(argv: string[]): { args: RunArgs | null; exitCode: number } {
  const out: RunArgs = { prompt: '', url: null, save: null, agent: null, model: null, cwd: null };
  const takeValue = (a: string, i: number): { v: string; i: number } | null => {
    const eq = a.indexOf('=');
    if (eq !== -1) return { v: a.slice(eq + 1), i };
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('-')) { err(`${a} requires a value.`); return null; }
    return { v: next, i: i + 1 };
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' || a.startsWith('--url=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.url = r.v; i = r.i;
    } else if (a === '--save' || a.startsWith('--save=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.save = r.v; i = r.i;
    } else if (a === '--agent' || a.startsWith('--agent=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.agent = r.v; i = r.i;
    } else if (a === '--model' || a.startsWith('--model=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.model = r.v; i = r.i;
    } else if (a === '--cwd' || a === '-C' || a.startsWith('--cwd=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.cwd = r.v; i = r.i;
    } else if (a.startsWith('-')) {
      err(`Unknown flag for run: ${a}`);
      return { args: null, exitCode: 2 };
    } else if (!out.prompt) {
      out.prompt = a;
    } else {
      err(`Unexpected extra argument: ${a} (quote the prompt: hover run "...")`);
      return { args: null, exitCode: 2 };
    }
  }
  if (!out.prompt) {
    err(`Usage: hover run "<prompt>" [--url <devUrl>] [--save <slug>] [--agent <id>] [--model <m>]`);
    return { args: null, exitCode: 2 };
  }
  return { args: out, exitCode: 0 };
}
