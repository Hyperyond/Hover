/**
 * `hover-hook` — the Claude Code hooks helper. Each subcommand is wired to a
 * hook event in `.claude/settings.json` (write it with `hover-hook install`):
 *
 *   SessionStart      → `hover-hook session-start`  inject Cloud + active-env
 *                        orientation (who / which project / which env / drift).
 *   UserPromptSubmit  → `hover-hook user-prompt`    nudge guard-first when the
 *                        prompt looks like new behavior.
 *   Stop              → `hover-hook stop`            surface `.hover/` health
 *                        (deterministic lint) at end of turn.
 *
 * Contract: read the hook JSON on stdin, print a JSON result on stdout, exit 0.
 * These run every session/turn, so they stay light and NEVER break the session —
 * any error just prints `{}` and exits 0. Only `install` writes files / plain text.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THIRD TRIGGER AXIS — the boundary that keeps hooks from overlapping the
 * MCP tools/prompts (see server.ts for the tool-vs-prompt half):
 *
 *   Prompt  = user-typed `/mcp__hover__*`  → orchestrates a multi-step workflow
 *   Tool    = agent-invoked                → runs ONE primitive
 *   Hook    = lifecycle event (automatic)  → SURFACES / NUDGES, never more
 *
 * A hook must only READ the shared primitives (cloud data, lintWiki, replay) and
 * surface, suggest, or DETERMINISTICALLY GATE — it must never orchestrate a
 * workflow or auto-fix. If a hook auto-ran `/heal`, it would fight the user's
 * own prompts and the build loop. So: session-start injects context (doesn't
 * heal), user-prompt nudges toward /guard (doesn't declare), stop reminds via a
 * non-blocking systemMessage — and, ONLY when the user opted in with
 * `install --gate`, stop may BLOCK the turn from finishing while crystallized
 * flows fail replay (a deterministic check with a reason, not agency: it names
 * what's red and hands control back; fixing is still the agent's/user's move).
 * Reusing a primitive at a new trigger point is fine; re-implementing a
 * workflow here is not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectRepo,
  fetchHealRequests,
  fetchMe,
  healSlug,
  readCloudCredentials,
} from '@hover-dev/core/cloud';
import { loadHoverEnvFile, readActiveEnv } from '@hover-dev/core/activeEnv';

const CLOUD_TIMEOUT_MS = 6_000;
const timedFetch: typeof fetch = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) });

/** Read + JSON-parse the hook payload from stdin; `{}` on TTY / empty / bad JSON. */
async function readStdin(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  try {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj));
}

function cwdOf(input: Record<string, unknown>): string {
  return typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
}

// ── SessionStart: orient the agent ───────────────────────────────────────────
async function sessionStart(input: Record<string, unknown>): Promise<void> {
  const cwd = cwdOf(input);
  const lines: string[] = [];
  const active = readActiveEnv(cwd);
  if (active) lines.push(`Active environment: **${active.name}** (${active.url}) — a drive/heal targets this URL.`);

  const creds = readCloudCredentials();
  if (creds) {
    const repo = detectRepo(cwd);
    try {
      const me = await fetchMe(creds, timedFetch);
      const project = repo ? me.projects.find((p) => p.repo === repo) : undefined;
      if (project) {
        lines.push(`Hover Cloud: connected${me.user.email ? ` as ${me.user.email}` : ''}; project **${project.name}** (${project.org}).`);
        try {
          const heals = await fetchHealRequests(creds, { status: 'open', repo: repo ?? undefined }, timedFetch);
          if (heals.length) {
            const slugs = heals.slice(0, 8).map((h) => healSlug(h.specFile)).join(', ');
            lines.push(`${heals.length} spec(s) drifted in CI: ${slugs}. Heal with \`/mcp__hover__heal <slug>\`.`);
          }
        } catch {
          /* heal fetch failed — skip */
        }
      } else if (repo) {
        lines.push(`Hover Cloud connected, but ${repo} isn't a Cloud project yet (create one at cloud.gethover.dev/dashboard/new for CI runs + the heal queue).`);
      }
    } catch {
      /* offline / unreachable — stay silent */
    }
  }

  if (!lines.length) return emit({});
  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Hover:\n${lines.map((l) => `- ${l}`).join('\n')}`,
    },
  });
}

// ── UserPromptSubmit: guard-first nudge ──────────────────────────────────────
/** Heuristic: the prompt describes NEW behavior worth declaring as a contract
 *  first (verb + feature-ish noun). Deliberately conservative to avoid nagging. */
export function looksLikeFeatureWork(prompt: string): boolean {
  const verb = /\b(add|build|implement|create|ship|write|make)\b/i.test(prompt);
  const noun =
    /\b(feature|flow|page|screen|form|endpoint|api|button|checkout|log[- ]?in|sign[- ]?up|onboarding|dashboard|payment|cart|wizard|settings?)\b/i.test(
      prompt,
    );
  return verb && noun;
}

function userPrompt(input: Record<string, unknown>): void {
  const prompt = String(input.prompt ?? input.user_input ?? '');
  if (!looksLikeFeatureWork(prompt)) return emit({});
  emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        'Hover: this looks like new behavior. Consider `/mcp__hover__guard` to declare the acceptance criteria + business rules first, then `/mcp__hover__build` to drive it to green — so it lands with a crystallized regression test, not just code.',
    },
  });
}

// ── Stop: end-of-turn `.hover/` health, plus the opt-in verify GATE ──────────
async function stop(input: Record<string, unknown>, gate: boolean): Promise<void> {
  const cwd = cwdOf(input);
  // The gate first: red flows block the finish (opt-in via `install --gate`).
  // `stop_hook_active` = we already blocked this turn once — let it through
  // rather than looping the agent against the 8-block cap.
  if (gate && input.stop_hook_active !== true) {
    const verdict = await verifyGate(cwd);
    if (verdict) return emit(verdict);
  }
  try {
    // Dynamic import so session-start / user-prompt never pay the engine load.
    const { lintWiki } = await import('@hover-dev/core/engine');
    const res = await lintWiki(cwd);
    if (res.ok || !res.findings?.length) return emit({});
    const top = res.findings.slice(0, 5).map((f) => f.message);
    emit({
      systemMessage: `Hover: ${res.findings.length} test-wiki issue(s) — ${top.join('; ')}. Heal with /mcp__hover__heal, or update the map.`,
    });
  } catch {
    emit({});
  }
}

/** How many flows the gate replays at most — a turn-end check, not a suite run. */
const GATE_MAX_SPECS = 12;
const GATE_CDP_URL = `http://localhost:${process.env.HOVER_CDP_PORT || 9222}`;

/** The deterministic finish gate: replay the crystallized flows against the
 *  live app; any failure blocks the stop with the exact red list. FAIL-OPEN on
 *  every setup condition (no specs / app not running / missing creds / any
 *  error) — the gate exists to stop "done" on top of broken flows, never to
 *  wedge a session over configuration. Returns null to let the stop through. */
async function verifyGate(cwd: string): Promise<Record<string, unknown> | null> {
  try {
    const dir = join(cwd, '.hover', 'sidecars');
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
    if (!files.length) return null;

    const { readSidecar, replayOnPage, launchDebugChrome } = await import('@hover-dev/core/engine');
    loadHoverEnvFile(cwd); // HOVER_<LABEL>_USER/PASS for logged-in flows
    const target = process.env.HOVER_TARGET || readActiveEnv(cwd)?.url || 'http://localhost:5173';
    try {
      await fetch(target, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
    } catch {
      return null; // app not running — nothing meaningful to gate on
    }

    // Share the MCP's debug Chrome when it's up; launch one otherwise.
    const { chromium } = await import('playwright-core');
    let browser;
    try {
      browser = await chromium.connectOverCDP(GATE_CDP_URL, { timeout: 1500 });
    } catch {
      await launchDebugChrome({ port: Number(process.env.HOVER_CDP_PORT || 9222), url: target });
      browser = await chromium.connectOverCDP(GATE_CDP_URL, { timeout: 8000 });
    }
    try {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const slugs = files.map((f) => f.replace(/\.json$/, '')).sort().slice(0, GATE_MAX_SPECS);
      const red: string[] = [];
      let verified = 0;
      for (const slug of slugs) {
        const sc = await readSidecar(cwd, slug);
        if (!sc) continue;
        if ((sc.redactionEnvVars ?? []).some((v) => process.env[v] === undefined)) continue; // creds missing → skip, not red
        const res = await replayOnPage(page, target, sc.steps as never);
        verified++;
        if (!res.ok) {
          const f = res.failures[0];
          red.push(`${slug} (step ${f?.index}: ${String(f?.error ?? '').slice(0, 80)})`);
        }
      }
      if (red.length) {
        return {
          decision: 'block',
          reason:
            `Hover gate: ${red.length} of ${verified} crystallized flow(s) failed replay against ${target}: ${red.join('; ')}. ` +
            `Fix the code (or heal a CONFIRMED drift) before finishing — verify_specs gives the full detail. ` +
            `If this red is expected, tell the user why instead of stopping silently.`,
        };
      }
      if (verified) return { systemMessage: `Hover gate: ${verified} flow(s) replayed green against ${target}.` };
      return null;
    } finally {
      await browser.close().catch(() => {}); // CDP: disconnects, doesn't kill the user's Chrome
    }
  } catch {
    return null; // any internal error → fail open
  }
}

// ── install: write the hooks block into .claude/settings.json ─────────────────
function install(gate: boolean): void {
  const cmds: Record<string, string> = {
    SessionStart: 'hover-hook session-start',
    UserPromptSubmit: 'hover-hook user-prompt',
    // --gate upgrades the Stop hook from a reminder to a finish gate: red
    // crystallized flows BLOCK the turn from ending (fail-open on any setup gap).
    Stop: gate ? 'hover-hook stop --verify' : 'hover-hook stop',
  };
  const cwd = process.cwd();
  const dir = join(cwd, '.claude');
  const file = join(dir, 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      process.stderr.write(`hover-hook: ${file} is not valid JSON — fix or remove it, then re-run.\n`);
      process.exit(1);
    }
  }
  const hooks = (settings.hooks ??= {}) as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  for (const [event, cmd] of Object.entries(cmds)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    // Idempotent: drop any prior hover-hook group for this event, re-add ours.
    const kept = groups.filter((g) => !(g.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('hover-hook')));
    kept.push({ hooks: [{ type: 'command', command: cmd, ...(event === 'Stop' ? { timeout: gate ? 180 : 60 } : {}) }] } as never);
    hooks[event] = kept;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `hover-hook: wrote SessionStart / UserPromptSubmit / Stop hooks to ${file}${gate ? ' (Stop runs the verify GATE: red flows block the finish)' : ''}.\n` +
      (gate ? '' : `Want "no green, no done"? Re-run as: hover-hook install --gate\n`) +
      `Reload your coding agent (or restart Claude Code) to activate.\n`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const flags = new Set(process.argv.slice(3));
  if (cmd === 'install') return install(flags.has('--gate'));
  const input = await readStdin();
  switch (cmd) {
    case 'session-start':
      return sessionStart(input);
    case 'user-prompt':
      return userPrompt(input);
    case 'stop':
      return stop(input, flags.has('--verify'));
    default:
      // Unknown subcommand as a hook → no-op JSON; as a manual run → usage.
      if (process.stdin.isTTY) {
        process.stdout.write('Usage: hover-hook <install [--gate]|session-start|user-prompt|stop [--verify]>\n');
      } else {
        emit({});
      }
  }
}

// Run only when invoked as the CLI — NOT when imported (tests import
// `looksLikeFeatureWork`; running main() there would block on stdin forever).
// Compare REAL paths: the `hover-hook` bin is a symlink to this file, so
// argv[1] (the symlink) won't equal import.meta.url (the realpath) directly.
function isCliEntry(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isCliEntry()) {
  await main();
}
