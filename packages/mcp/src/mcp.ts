import { basename } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  launchDebugChrome,
  writeSpec,
  writeApiSpec,
  writeFact,
  recallMemory,
  readFact,
  formatFact,
  readSidecar,
  detectExtractableFlows,
  extractPageObjects,
  buildOptimizeBrief,
  saveOptimizedCandidate,
  promoteOptimizedCandidate,
  lintWiki,
  appendWikiLog,
  readActiveEnv,
  declareGuard,
  recordApiOnMap,
  endpointLabel,
  type SkillStep,
  type ApiCheck,
  type Redaction,
} from '@hover-dev/core/engine';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { parsePlaywrightRun } from '@hover-dev/core/dashboard';
import { detectRepo, fetchHealRequests, fetchMe, fetchRunResult, readCloudCredentials } from '@hover-dev/core/cloud';
import { HoverMcpController } from './mcp/controller.js';
import { createHoverMcpServer } from './mcp/server.js';

/*
 * `hover-mcp` — the MCP-first surface. Add it to your OWN agent (Claude Code,
 * Cursor, …); the agent drives the app through Hover's grounded tools and calls
 * crystallize_spec to save a plain Playwright spec. Hover spawns no agent here —
 * the calling agent IS the intelligence; Hover guarantees record==replay at the
 * output. Config via env: HOVER_TARGET, HOVER_CDP_PORT, HOVER_PROJECT_ROOT,
 * HOVER_LANG (language the workflow prompts tell the agent to converse in).
 *
 * NOTE: stdio is the MCP transport — never write to stdout from this process.
 */

const PORT = Number(process.env.HOVER_CDP_PORT || 9222);
const LANG = process.env.HOVER_LANG;
const DEV_ROOT = process.env.HOVER_PROJECT_ROOT || process.cwd();
const CDP_URL = `http://localhost:${PORT}`;

// Load `.hover/.env` (the extension's "export env vars" output) into process.env
// so a drive/heal can log in with HOVER_<LABEL>_USER/PASS. Never overrides an
// already-set var; missing file is fine. Plaintext + gitignored, local only.
function loadHoverDotenv(devRoot: string): void {
  const p = join(devRoot, '.hover', '.env');
  if (!existsSync(p)) return;
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* unreadable — skip */
  }
}
loadHoverDotenv(DEV_ROOT);

// Target precedence: explicit HOVER_TARGET wins (CI, autoheal); otherwise follow
// the environment the user activated in the editor (.hover/active.json); else a
// sensible localhost default. Track WHERE it came from so an unreachable target
// can say exactly what to fix instead of handing the agent a blank page.
const activeEnvAtBoot = readActiveEnv(DEV_ROOT);
const TARGET = process.env.HOVER_TARGET || activeEnvAtBoot?.url || 'http://localhost:5173';
const TARGET_SOURCE = process.env.HOVER_TARGET
  ? 'HOVER_TARGET'
  : activeEnvAtBoot?.url
    ? `the active environment "${activeEnvAtBoot.name}" (.hover/active.json)`
    : 'the built-in default (no HOVER_TARGET, no active environment)';

/** Fail fast when the target app isn't answering — BEFORE launching a browser.
 *  Any HTTP response (even 4xx/5xx) counts as reachable; only a network-level
 *  failure stops. Cached once per process after a success. */
let targetVerified = false;
async function assertTargetReachable(): Promise<void> {
  if (targetVerified) return;
  try {
    await fetch(TARGET, { method: 'HEAD', signal: AbortSignal.timeout(4000), redirect: 'manual' });
    targetVerified = true;
  } catch {
    // Some dev servers reject HEAD — retry once with GET before concluding.
    try {
      await fetch(TARGET, { signal: AbortSignal.timeout(4000), redirect: 'manual' });
      targetVerified = true;
    } catch {
      throw new Error(
        `target ${TARGET} is not responding (from ${TARGET_SOURCE}). ` +
          `Is the app running? Start the dev server, or point Hover at the right URL: ` +
          `activate the correct environment in VS Code (Environments tab) or set HOVER_TARGET. ` +
          `Nothing was driven — this is a setup problem, not app drift.`,
      );
    }
  }
}

const originOf = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

let browser: Browser | null = null;

/** Launch/connect the debug Chrome lazily and return the page on the app. */
async function getPage(): Promise<Page> {
  if (!browser || !browser.isConnected()) {
    await assertTargetReachable(); // fail fast with the fix, not a blank page
    await launchDebugChrome({ port: PORT, url: TARGET });
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 8000 });
  }
  const pages = browser.contexts().flatMap((ctx) => ctx.pages());
  const want = originOf(TARGET);
  const match = want ? pages.find((p) => originOf(p.url()) === want) : undefined;
  if (match) return match;
  if (pages.length) return pages[pages.length - 1];
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  return ctx.newPage();
}

const controller = new HoverMcpController({
  getPage,
  crystallize: async (name: string, description: string | undefined, steps: SkillStep[], redactions: Redaction[]) => {
    const res = await writeSpec({ devRoot: DEV_ROOT, name, description, steps, redactions, startUrl: TARGET, overwrite: true });
    await appendWikiLog(DEV_ROOT, 'crystallize', `${basename(res.path)} — ${name}`);
    return { path: res.path };
  },
  crystallizeApi: async (name: string, description: string | undefined, checks: ApiCheck[]) => {
    const res = await writeApiSpec({ devRoot: DEV_ROOT, name, description, checks, startUrl: TARGET, overwrite: true });
    await appendWikiLog(DEV_ROOT, 'api', `${basename(res.path)} — ${name}`);
    // Surface the locked contracts on the business map's `## API` area, so the
    // API layer is visible alongside the UI flows (best-effort — the spec is
    // already written; a map hiccup must not fail the crystallize).
    await recordApiOnMap(DEV_ROOT, {
      name: res.slug,
      endpoints: checks.map((c) => endpointLabel(c.method, c.url)),
      specFile: res.path,
    }).catch(() => {});
    return { path: res.path };
  },
  recordFact: (title, rule, type, line) =>
    writeFact(DEV_ROOT, { name: title, description: title, type, body: rule, ...(line ? { line } : {}) }),
  recall: () => recallMemory(DEV_ROOT),
  recallFact: async (name: string) => {
    const fact = await readFact(DEV_ROOT, name);
    return fact ? formatFact(fact) : null;
  },
  readSpecSteps: async (slug: string) => {
    const sc = await readSidecar(DEV_ROOT, slug);
    return sc ? { steps: sc.steps, startUrl: TARGET, redactionEnvVars: sc.redactionEnvVars } : null;
  },
  detectSharedFlows: () => detectExtractableFlows(DEV_ROOT),
  extractPageObjects: async () => {
    const res = await extractPageObjects(DEV_ROOT);
    if (res.pages.length) {
      await appendWikiLog(DEV_ROOT, 'extract', `${res.pages.length} page object(s), folded ${res.folded.length} spec(s)`);
    }
    return res;
  },
  optimizeBrief: async (slug: string) => {
    try {
      const { prompt } = await buildOptimizeBrief(DEV_ROOT, slug);
      return { prompt };
    } catch (e) {
      return { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
    }
  },
  saveOptimized: (slug: string, code: string) => saveOptimizedCandidate(DEV_ROOT, slug, code),
  promoteOptimized: (slug: string) => promoteOptimizedCandidate(DEV_ROOT, slug),
  lintWiki: () => lintWiki(DEV_ROOT),
  cloudFailures: async (repo?: string) => {
    const creds = readCloudCredentials();
    if (!creds) {
      return {
        error:
          'Hover Cloud not connected — set HOVER_CLOUD_TOKEN (mint one at https://cloud.gethover.dev → Settings → Access tokens) or run "Hover: Connect Hover Cloud" in VS Code.',
      };
    }
    try {
      return await fetchHealRequests(creds, { status: 'open', ...(repo ? { repo } : {}) });
    } catch (e) {
      return { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
    }
  },
  cloudRunResult: async (sha?: string, repo?: string) => {
    const creds = readCloudCredentials();
    if (!creds) {
      return {
        error:
          'Hover Cloud not connected — set HOVER_CLOUD_TOKEN or run "Hover: Connect Hover Cloud" in VS Code.',
      };
    }
    const target = repo ?? detectRepo(DEV_ROOT);
    if (!target) {
      return { error: 'No GitHub repo detected (no git origin) — pass repo: "owner/name".' };
    }
    try {
      return await fetchRunResult(creds, target, sha);
    } catch (e) {
      return { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
    }
  },
  declareGuard: (d) => declareGuard(DEV_ROOT, d),
  listSpecSlugs: async () => {
    try {
      const files = await readdir(join(DEV_ROOT, '.hover', 'sidecars'));
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
    } catch {
      return []; // no sidecars dir yet
    }
  },
  // Faithful verify: the REAL spec files through the REAL engine — exactly what
  // CI runs. BASE_URL follows the same target the drive uses.
  runSpecTests: async (slugs) => {
    const exec = promisify(execFile);
    const args = ['playwright', 'test', ...slugs.map((s) => `${s}.spec.ts`), '--reporter=json'];
    let stdout: string;
    try {
      ({ stdout } = await exec('npx', args, {
        cwd: DEV_ROOT,
        env: { ...process.env, BASE_URL: TARGET },
        timeout: 5 * 60_000,
        maxBuffer: 32 * 1024 * 1024,
      }));
    } catch (e) {
      // `playwright test` exits non-zero when specs FAIL — that still produces
      // the JSON report on stdout. Only a missing report is a real run error.
      const err = e as { stdout?: string; message?: string };
      if (!err.stdout?.trim().startsWith('{')) {
        return {
          error: `couldn't run \`npx playwright test\` in ${DEV_ROOT} — is @playwright/test installed in this project? (${(err.message ?? '').split('\n')[0]})`,
        };
      }
      stdout = err.stdout;
    }
    let report: unknown;
    try {
      report = JSON.parse(stdout);
    } catch {
      return { error: 'playwright test produced no parseable JSON report' };
    }
    const statuses = parsePlaywrightRun(report); // { '<slug>.spec.ts': pass|fail|flaky }
    const errors = firstErrorsByFile(report);
    return {
      results: slugs.map((slug) => {
        const s = statuses[`${slug}.spec.ts`];
        if (s === 'pass' || s === 'flaky') return { spec: slug, status: 'pass' as const };
        return {
          spec: slug,
          status: 'fail' as const,
          error:
            s === 'fail'
              ? (errors.get(`${slug}.spec.ts`) ?? 'failed (see playwright output)')
              : 'did not run — the file filter matched nothing (was the spec renamed?)',
        };
      }),
    };
  },
  cloudContext: async () => {
    const creds = readCloudCredentials();
    if (!creds) {
      return {
        error:
          'Hover Cloud not connected — set HOVER_CLOUD_TOKEN or run "Hover: Connect Hover Cloud" in VS Code.',
      };
    }
    const repo = detectRepo(DEV_ROOT);
    const active = readActiveEnv(DEV_ROOT);
    try {
      const me = await fetchMe(creds);
      const project = repo ? me.projects.find((p) => p.repo === repo) : undefined;
      return {
        email: me.user.email,
        repo,
        project: project
          ? {
              name: project.name,
              org: project.org,
              repo: project.repo,
              environments: project.environments ?? [],
              accounts: project.accounts ?? [],
            }
          : null,
        activeEnv: active ? { name: active.name, url: active.url } : null,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
    }
  },
});

/** First error line per spec-file basename from a Playwright JSON report —
 *  enough for the agent to know WHY without the full report. Defensive walk. */
function firstErrorsByFile(report: unknown): Map<string, string> {
  const out = new Map<string, string>();
  interface Suite { file?: string; specs?: Array<{ file?: string; tests?: Array<{ results?: Array<{ error?: { message?: string } }> }> }>; suites?: Suite[] }
  const visit = (suite: Suite, inherited?: string): void => {
    const file = suite.file ?? inherited;
    for (const spec of suite.specs ?? []) {
      const base = (spec.file ?? file ?? '').split(/[\\/]/).pop() ?? '';
      if (!base || out.has(base)) continue;
      for (const t of spec.tests ?? []) {
        const msg = t.results?.map((r) => r.error?.message).find(Boolean);
        if (msg) {
          out.set(base, msg.replace(/\[[0-9;]*m/g, '').split('\n').find((l) => l.trim())?.slice(0, 300) ?? 'failed');
          break;
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, file);
  };
  for (const s of ((report as { suites?: Suite[] })?.suites ?? [])) visit(s);
  return out;
}

const server = createHoverMcpServer(controller, { lang: LANG });
await server.connect(new StdioServerTransport());
