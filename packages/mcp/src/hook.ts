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
 * A hook must only READ the shared primitives (cloud data, lintWiki, …) and
 * surface or suggest — it must NEVER orchestrate a workflow or block/gate. If a
 * hook auto-ran `/heal` or blocked "until green", it would fight the user's own
 * prompts and the build loop. So: session-start injects context (doesn't heal),
 * user-prompt nudges toward /guard (doesn't declare), stop reminds via a
 * non-blocking systemMessage (doesn't fix or block). Reusing a primitive at a
 * new trigger point is fine; re-implementing a workflow here is not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  detectRepo,
  fetchHealRequests,
  fetchMe,
  healSlug,
  readCloudCredentials,
} from '@hover-dev/core/cloud';
import { readActiveEnv } from '@hover-dev/core/activeEnv';

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

// ── Stop: end-of-turn `.hover/` health (deterministic, no browser) ───────────
async function stop(input: Record<string, unknown>): Promise<void> {
  const cwd = cwdOf(input);
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

// ── install: write the hooks block into .claude/settings.json ─────────────────
const HOOK_CMDS: Record<string, string> = {
  SessionStart: 'hover-hook session-start',
  UserPromptSubmit: 'hover-hook user-prompt',
  Stop: 'hover-hook stop',
};

function install(): void {
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
  for (const [event, cmd] of Object.entries(HOOK_CMDS)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    // Idempotent: drop any prior hover-hook group for this event, re-add ours.
    const kept = groups.filter((g) => !(g.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('hover-hook')));
    kept.push({ hooks: [{ type: 'command', command: cmd, ...(event === 'Stop' ? { timeout: 60 } : {}) }] } as never);
    hooks[event] = kept;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `hover-hook: wrote SessionStart / UserPromptSubmit / Stop hooks to ${file}.\n` +
      `Reload your coding agent (or restart Claude Code) to activate them.\n`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'install') return install();
  const input = await readStdin();
  switch (cmd) {
    case 'session-start':
      return sessionStart(input);
    case 'user-prompt':
      return userPrompt(input);
    case 'stop':
      return stop(input);
    default:
      // Unknown subcommand as a hook → no-op JSON; as a manual run → usage.
      if (process.stdin.isTTY) {
        process.stdout.write('Usage: hover-hook <install|session-start|user-prompt|stop>\n');
      } else {
        emit({});
      }
  }
}

// Run only when invoked as the CLI — NOT when imported (tests import
// `looksLikeFeatureWork`; running main() there would block on stdin forever).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
