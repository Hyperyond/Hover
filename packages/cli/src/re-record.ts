/**
 * `hover re-record <spec>` — regenerate a Hover-saved Playwright spec
 * against the current UI.
 *
 * Why this exists: Hover specs use semantic selectors (`getByRole /
 * getByLabel / getByTestId`), so most layout / markup churn doesn't break
 * them. But when the UI changes enough — button text rewritten, label
 * split, role changed — the spec turns red on CI. Editing by hand works,
 * but the spec's JSDoc header already stores the `Original prompt:`
 * (natural language: "log in then add a todo"). This subcommand reads
 * that prompt, drives the agent on the CURRENT UI, and overwrites the
 * spec with newly-generated selectors.
 *
 * Trade-off vs. AI-self-heal-at-CI: CI stays deterministic + free
 * (no AI tokens on every test run) at the cost of one ~30s, ~$0.10 CLI
 * invocation when the UI shifts. The intent is stable across UI churn.
 *
 * Implementation: starts a one-shot @hover-dev/core service, WS-connects,
 * sends the parsed prompt with `reRecord: { slug }` so the service knows
 * to collect tool_use events and overwrite the spec on session_end. After
 * the service writes the new spec, prints a `git diff` for review.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bold, cyan, dim, err, info, ok, spark, warn } from './log.js';

interface RecordArgs {
  spec: string;
  cwd: string | null;
  dryRun: boolean;
  port: number;
}

export async function runReRecord(args: RecordArgs): Promise<number> {
  // ─── locate the spec ───────────────────────────────────────────────
  const cwd = args.cwd
    ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
    : process.cwd();
  if (args.cwd && !existsSync(cwd)) {
    err(`--cwd path does not exist: ${cwd}`);
    return 1;
  }
  const specPath = resolveSpecPath(args.spec, cwd);
  if (!specPath) {
    err(`Could not find a spec matching "${args.spec}".`);
    err(`Tried as a path and as a slug under ${cyan(join(cwd, '__vibe_tests__'))}.`);
    return 1;
  }
  info(`Spec: ${cyan(specPath)}`);

  // ─── parse the JSDoc header locally (fail fast before booting anything) ──
  const source = readFileSync(specPath, 'utf-8');
  const header = parseSpecHeader(source);
  if (!header.originalPrompt) {
    err(`This spec has no ${bold('Original prompt:')} JSDoc header — it was hand-authored.`);
    err(`Re-record needs the natural-language intent to drive the agent. Either:`);
    err(`  1. Add an ${cyan('* Original prompt: …')} line to the spec's JSDoc, or`);
    err(`  2. Delete the spec and re-record from scratch in the widget.`);
    return 1;
  }
  info(`Original prompt: ${dim(header.originalPrompt)}`);

  const slug = basename(specPath).replace(/\.spec\.ts$/, '');

  // ─── resolve @hover-dev/core dynamically from cwd ──────────────────
  let coreEntry: string;
  try {
    coreEntry = resolveCoreEntry(cwd);
  } catch (e) {
    err(`Couldn't find ${cyan('@hover-dev/core')} in ${cyan(cwd)}.`);
    err(`Install Hover for this project first: ${cyan('npx @hover-dev/cli add')}.`);
    err(`Or pass --cwd to a project that has it installed.`);
    err(`Original error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const { startService } = (await import(coreEntry)) as {
    startService: (opts: {
      port: number;
      agentId: string;
      model: string;
      cdpUrl: string;
      devRoot: string;
    }) => Promise<{
      port: number;
      close(): Promise<void>;
    }>;
  };

  info(`Booting a temporary Hover service on port ${args.port} (auto-bumps if busy)…`);
  let service: Awaited<ReturnType<typeof startService>>;
  try {
    service = await startService({
      port: args.port,
      agentId: process.env.HOVER_AGENT ?? 'claude',
      model: process.env.HOVER_MODEL ?? 'sonnet',
      cdpUrl: process.env.HOVER_CDP ?? 'http://localhost:9222',
      devRoot: cwd,
    });
  } catch (e) {
    err(`Failed to start service: ${e instanceof Error ? e.message : String(e)}`);
    err(`Is a debug Chrome running on ${cyan('http://localhost:9222')}? Try ${cyan('pnpm smoke:chrome')}.`);
    return 1;
  }

  // ─── replay the prompt with reRecord intent ────────────────────────
  const result = await runOneCommand({
    port: service.port,
    prompt: header.originalPrompt,
    slug: args.dryRun ? null : slug, // dry-run: no slug → service skips the overwrite
  });
  await service.close();

  if (!result.ok) {
    err(result.reason ?? 'Re-record failed.');
    return 1;
  }

  if (args.dryRun) {
    spark(`Dry-run complete — agent finished, no files written.`);
    if (result.summary) {
      info(`Agent's summary:`);
      console.log('  ' + result.summary.split('\n').join('\n  '));
    }
    info(`Run again without ${cyan('--dry-run')} to overwrite the spec.`);
    return 0;
  }

  if (!result.specWritten) {
    err(`The agent finished but no spec was written. Run without --dry-run on the next attempt.`);
    if (result.summary) console.log(dim('Agent summary: ' + result.summary));
    return 1;
  }

  ok(`Spec overwritten: ${cyan(specPath)}`);
  info(`Review the change:`);
  console.log('');
  const diff = spawnSync('git', ['diff', '--', specPath], { cwd, encoding: 'utf-8' });
  if (diff.status === 0 && diff.stdout) {
    console.log(diff.stdout);
  } else if (diff.status === 0) {
    info(`(${dim('git diff is empty — agent produced byte-identical spec')})`);
  } else {
    warn(`git diff exited with ${diff.status}. Run ${cyan(`git diff -- ${specPath}`)} manually.`);
  }
  console.log('');
  info(`Accept: ${cyan('git add ' + specPath + ' && git commit')}`);
  info(`Reject: ${cyan('git checkout -- ' + specPath)}`);
  return 0;
}

/**
 * Spec path resolution:
 *   - absolute path that exists → use it
 *   - relative path that exists from cwd → use it
 *   - bare slug ("login") → check __vibe_tests__/<slug>.spec.ts under cwd
 *   - slug-with-ext ("login.spec.ts") → check the same path
 */
function resolveSpecPath(input: string, cwd: string): string | null {
  if (isAbsolute(input) && existsSync(input)) return input;
  const rel = resolve(cwd, input);
  if (existsSync(rel)) return rel;
  const ext = input.endsWith('.spec.ts') ? input : `${input}.spec.ts`;
  const inDir = join(cwd, '__vibe_tests__', ext);
  if (existsSync(inDir)) return inDir;
  return null;
}

/**
 * Walk up from `cwd` looking for node_modules/@hover-dev/core/dist/service.js.
 * Returns a file:// URL ready for dynamic import. Uses the same path
 * convention the integration shims use (dist/service.js) to avoid relying
 * on `exports` map subpath resolution, which is brittle across pnpm hoisting.
 */
function resolveCoreEntry(cwd: string): string {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, 'node_modules', '@hover-dev', 'core', 'dist', 'service.js');
    if (existsSync(candidate)) return `file://${candidate}`;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('@hover-dev/core not found in any ancestor node_modules/');
}

/**
 * Local copy of the JSDoc parser from @hover-dev/core/specs/listSpecs.ts.
 * Duplicated (one regex match) to keep the CLI cold-start path light — we
 * don't want to dynamically import @hover-dev/core just to parse 3 lines.
 */
function parseSpecHeader(source: string): { originalPrompt: string | null } {
  const beforeFirstTest = source.split(/^\s*(?:test|test\.describe)\s*\(/m)[0] ?? source;
  const blockMatch = beforeFirstTest.match(/\/\*\*([\s\S]*?)\*\//);
  if (!blockMatch) return { originalPrompt: null };
  const m = blockMatch[1].match(/^\s*\*\s*Original prompt:\s*(.+?)\s*$/m);
  return { originalPrompt: m ? m[1].trim() : null };
}

interface OneCommandResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  specWritten?: boolean;
}

/**
 * WS round-trip:
 *   1. Connect, send `command { text, reRecord: { slug } }` (slug null in
 *      dry-run → service won't overwrite).
 *   2. Stream tool_use events into a turn counter (`.` per turn on stderr).
 *   3. On `session_end`: capture summary + isError. Resolve.
 *   4. Wait briefly for an optional `spec-saved` message that comes AFTER
 *      session_end when the service finishes writing the file. If a
 *      timeout elapses without it, conclude the write failed.
 */
async function runOneCommand(opts: {
  port: number;
  prompt: string;
  slug: string | null;
}): Promise<OneCommandResult> {
  // Use the global WebSocket constructor (Node 22+) rather than the `ws`
  // package — saves the CLI a transitive dep + ~500ms cold start.
  const WSCtor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WSCtor) {
    return {
      ok: false,
      reason: 'globalThis.WebSocket not available — Node 22+ required',
    };
  }
  return new Promise<OneCommandResult>((resolve) => {
    const ws = new WSCtor(`ws://127.0.0.1:${opts.port}`);
    let sessionEnded = false;
    let summary = '';
    let sessionError = false;
    let specWritten = false;
    let postSessionTimer: NodeJS.Timeout | null = null;
    const TIMEOUT_MS = 10 * 60 * 1000;

    const finish = (result: OneCommandResult) => {
      if (postSessionTimer) clearTimeout(postSessionTimer);
      try { ws.close(1000); } catch { /* already closed */ }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ ok: false, reason: `timed out after ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);

    ws.addEventListener('open', () => {
      info(`Connected. Replaying prompt against the current UI…`);
      ws.send(JSON.stringify({
        type: 'command',
        payload: opts.slug
          ? { text: opts.prompt, reRecord: { slug: opts.slug } }
          : { text: opts.prompt },
      }));
    });

    ws.addEventListener('message', (e) => {
      const raw = typeof e.data === 'string' ? e.data : String(e.data);
      let msg: { type: string; payload?: { kind?: string; summary?: string; isError?: boolean; text?: string; message?: string; path?: string } };
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'event' && msg.payload) {
        const ev = msg.payload;
        if (ev.kind === 'tool_use') process.stderr.write('.');
        if (ev.kind === 'session_end' && !sessionEnded) {
          sessionEnded = true;
          process.stderr.write('\n');
          summary = ev.summary ?? '';
          sessionError = ev.isError === true;
          if (sessionError) {
            clearTimeout(timeout);
            finish({ ok: false, reason: `agent reported error: ${summary || '(no summary)'}`, summary });
            return;
          }
          if (!opts.slug) {
            // Dry-run: no overwrite expected. Resolve immediately.
            clearTimeout(timeout);
            finish({ ok: true, summary });
            return;
          }
          // Real run: wait briefly for the service's spec-saved confirmation.
          postSessionTimer = setTimeout(() => {
            clearTimeout(timeout);
            finish({ ok: true, summary, specWritten: false });
          }, 8000);
        }
      } else if (msg.type === 'spec-saved' && msg.payload?.path) {
        specWritten = true;
        clearTimeout(timeout);
        finish({ ok: true, summary, specWritten: true });
      } else if (msg.type === 'error' && msg.payload?.message) {
        clearTimeout(timeout);
        finish({ ok: false, reason: msg.payload.message, summary, specWritten });
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      finish({ ok: false, reason: 'WebSocket error connecting to service' });
    });
  });
}

// ─── argv plumbing ──────────────────────────────────────────────────

/**
 * Parse the subset of argv this subcommand owns. Called from index.ts
 * when argv[0] === 're-record'.
 */
export function parseReRecordArgs(argv: string[]): { args: RecordArgs | null; exitCode: number } {
  const out: RecordArgs = { spec: '', cwd: null, dryRun: false, port: 51789 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--cwd' || a === '-C') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) { err(`${a} requires a path argument.`); return { args: null, exitCode: 2 }; }
      out.cwd = next; i++;
    } else if (a.startsWith('--cwd=')) {
      out.cwd = a.slice('--cwd='.length);
    } else if (a === '--port') {
      const next = argv[i + 1];
      if (!next) { err(`--port requires a number.`); return { args: null, exitCode: 2 }; }
      out.port = Number(next); i++;
      if (!Number.isFinite(out.port)) { err(`--port must be a number.`); return { args: null, exitCode: 2 }; }
    } else if (a.startsWith('--port=')) {
      out.port = Number(a.slice('--port='.length));
    } else if (a.startsWith('-')) {
      err(`Unknown flag for re-record: ${a}`);
      return { args: null, exitCode: 2 };
    } else if (!out.spec) {
      out.spec = a;
    } else {
      err(`Unexpected extra argument: ${a}`);
      return { args: null, exitCode: 2 };
    }
  }
  if (!out.spec) {
    err(`Usage: hover re-record <spec> [--dry-run] [--cwd <path>] [--port <n>]`);
    return { args: null, exitCode: 2 };
  }
  return { args: out, exitCode: 0 };
}
