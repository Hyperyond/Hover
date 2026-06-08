/**
 * `hover scan ["<scope>"]` — RED penetration-testing mode from the terminal.
 *
 * Where `hover run` drives a plain Playwright session, `scan` composes the full
 * offensive runtime: it boots the @hover-dev/security sidecars (resident HTTPS
 * MITM proxy + the control plane the security MCP server talks to), launches a
 * SEPARATE proxied debug Chrome (own port + profile, so it never disturbs a
 * normal :9222 debug Chrome), and runs an agent session whose system prompt is
 * the offensive objective from @hover-dev/pentest — origin-locked, destructive
 * ON, confirm in-band. When the session ends it reads the recorded checks from
 * the control plane and writes a Markdown findings report (with an explicit
 * "what was NOT tested" section).
 *
 * Positional <scope> is a natural-language feature ("the checkout flow"); omit
 * it to scan the whole site. `--url` is required — it's the dev origin the scan
 * is LOCKED to (and where Chrome opens). No default budget cap; pass
 * `--max-budget-usd` to set one.
 *
 * Like `run`, it dynamically imports the project's installed dists (core +
 * security + pentest) so the CLI itself stays near-zero-dependency.
 */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { bold, cyan, dim, err, ok, head, line, sub, gap, done, tail } from './log.js';

export interface ScanArgs {
  /** Natural-language scope; null ⇒ whole site. */
  scope: string | null;
  /** Dev origin to lock to + open Chrome at. Required. */
  url: string | null;
  name: string | null;
  agent: string | null;
  model: string | null;
  cwd: string | null;
  maxBudgetUsd: number | null;
}

/** Walk up from `cwd` to a project's installed package dist that contains
 *  `sentinel`. Mirrors run.ts's resolveCoreDist, generalised. */
function resolvePkgDist(cwd: string, scopedPkg: string, sentinel: string): string | null {
  const [scope, name] = scopedPkg.split('/');
  let dir = cwd;
  for (;;) {
    const d = join(dir, 'node_modules', scope, name, 'dist');
    if (existsSync(join(d, sentinel))) return d;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Same sanitisation the core service applies to derive the agent's allow-list
 *  prefix from an MCP server id (Claude maps non-alphanumerics to `_`). */
function mcpAllowPrefix(serverId: string): string {
  return `mcp__${serverId.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

export async function runScan(args: ScanArgs): Promise<number> {
  const cwd = args.cwd
    ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
    : process.cwd();
  if (args.cwd && !existsSync(cwd)) {
    err(`--cwd path does not exist: ${cwd}`);
    return 1;
  }

  if (!args.url) {
    err(`scan needs ${cyan('--url <devUrl>')} — the dev origin to test (and lock to).`);
    err(`  ${cyan('hover scan --url http://localhost:5173')}            ${dim('# whole site')}`);
    err(`  ${cyan('hover scan "the checkout flow" --url http://localhost:5173')}`);
    return 1;
  }
  let origin: string;
  try {
    origin = new URL(args.url).origin;
  } catch {
    err(`--url is not a valid URL: ${args.url}`);
    return 1;
  }

  // Resolve the three installed dists. scan is heavier than run — it needs the
  // security runtime and the pentest report renderer alongside the core engine.
  const coreDist = resolvePkgDist(cwd, '@hover-dev/core', 'runSession.js');
  const securityDist = resolvePkgDist(cwd, '@hover-dev/security', 'index.js');
  const pentestDist = resolvePkgDist(cwd, '@hover-dev/pentest', 'index.js');
  const missing = [
    !coreDist && '@hover-dev/core',
    !securityDist && '@hover-dev/security',
    !pentestDist && '@hover-dev/pentest',
  ].filter(Boolean) as string[];
  if (missing.length) {
    err(`scan needs these installed under ${cyan(cwd)}: ${missing.map(m => cyan(m)).join(', ')}.`);
    err(`  ${cyan(`npm i -D ${missing.join(' ')}`)}`);
    return 1;
  }

  const agentId = args.agent ?? process.env.HOVER_AGENT ?? 'claude';
  const model = args.model ?? process.env.HOVER_MODEL ?? 'sonnet';
  // A dedicated proxied Chrome on its own port + profile, so a scan never
  // disturbs (or is disturbed by) a normal debug Chrome on :9222.
  const scanPort = Number(process.env.HOVER_SCAN_CDP_PORT) || 9333;
  const scanProfile = join(tmpdir(), 'hover-chrome-scan');
  const cdpUrl = `http://localhost:${scanPort}`;

  const { launchDebugChrome } = (await import(
    `file://${join(coreDist!, 'playwright', 'launchChrome.js')}`
  )) as { launchDebugChrome: (o: LaunchOpts) => Promise<LaunchResult> };
  const { resolveMcpConfig } = (await import(
    `file://${join(coreDist!, 'playwright', 'resolveMcpConfig.js')}`
  )) as { resolveMcpConfig: (o: McpConfigOpts) => string };
  const { runSession } = (await import(`file://${join(coreDist!, 'runSession.js')}`)) as {
    runSession: (o: RunSessionOpts, onEvent: (ev: RunEvent) => void) => Promise<RunSessionResult>;
  };
  const { startSecurityRuntime } = (await import(`file://${join(securityDist!, 'index.js')}`)) as {
    startSecurityRuntime: (o: { devRoot: string }) => Promise<SecurityRuntime>;
  };
  const { buildScanObjective, writeFindingsReport } = (await import(
    `file://${join(pentestDist!, 'index.js')}`
  )) as {
    buildScanObjective: (o: { scope: string | null; origin: string }) => string;
    writeFindingsReport: (o: WriteReportOpts) => Promise<{ path: string }>;
  };

  head(`${bold('hover scan')} ${dim('·')} ${cyan('RED pentest')} ${dim('·')} ${agentId} ${dim('·')} ${model}`);
  line(dim(`target ${origin}${args.scope ? ` · scope "${args.scope}"` : ' · whole site'} · destructive ON · origin-locked`));
  gap();

  let rt: SecurityRuntime | null = null;
  try {
    // 1 · boot the security runtime (MITM intercept + control plane + MCP env).
    head('Runtime');
    rt = await startSecurityRuntime({ devRoot: cwd });
    line(dim(`MITM proxy on :${rt.proxyPort} (intercept) · control plane up`));

    // 2 · launch the proxied debug Chrome (own port + profile).
    const launch = await launchDebugChrome({
      port: scanPort,
      userDataDir: scanProfile,
      url: origin,
      proxy: { port: rt.proxyPort, spki: rt.spki },
    });
    if (!launch.ok) {
      err(`couldn't start the proxied debug Chrome: ${launch.reason ?? 'unknown error'}`);
      return 1;
    }
    line(dim(launch.alreadyRunning ? `reusing scan Chrome on :${scanPort}` : `launched scan Chrome on :${scanPort}`));
    gap();

    // 3 · MCP config = Playwright (drive) + security flows (probe). Allow-list
    //     the security server so the hard sandbox lets the agent reach it.
    const mcpConfig = resolveMcpConfig({
      cdpUrl,
      port: scanPort,
      cwd,
      suffix: 'scan',
      extra: [{ id: rt.mcpServerId, command: process.execPath, args: [rt.mcpScriptPath], env: rt.mcpEnv }],
    });

    // 4 · drive the offensive session.
    const prompt = args.scope
      ? `Penetration-test "${args.scope}" on ${origin}.`
      : `Penetration-test the whole application at ${origin}.`;
    head(prompt);
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
    const result = await runSession(
      {
        prompt,
        agentId,
        model,
        cdpUrl,
        cwd,
        mcpConfig,
        allowedToolsExtra: [mcpAllowPrefix(rt.mcpServerId)],
        appendSystemPrompt: buildScanObjective({ scope: args.scope, origin }),
        maxBudgetUsd: args.maxBudgetUsd ?? undefined,
      },
      render,
    );

    gap();
    const meta = [lastTurns, lastCost].filter(Boolean).join(' · ');
    done(`${result.isError ? 'Ended with an error' : 'Scan complete'}${meta ? ` ${dim('·')} ${meta}` : ''}`);
    if (result.summary) line(result.summary.trim());

    // 5 · render the findings report from the recorded checks + the agent's
    //     own coverage-gap notes (so "Not tested" reflects what it skipped).
    const checks = rt.listChecks();
    const notTested = rt.listGaps();
    const reportName = args.name ?? (args.scope ?? 'scan');
    const written = await writeFindingsReport({ devRoot: cwd, name: reportName, checks, notTested });
    gap();
    if (checks.length === 0) {
      ok(`report written: ${cyan(relative(cwd, written.path))} ${dim('(no probes were recorded — see the agent summary above)')}`);
    } else {
      ok(`report written: ${cyan(relative(cwd, written.path))} ${dim(`(${checks.length} recorded check${checks.length === 1 ? '' : 's'})`)}`);
    }
    tail(`open it, then lock any real finding into a CI regression with ${cyan('@hover-dev/security')}`);

    return result.isError ? 1 : 0;
  } finally {
    await rt?.stop();
  }
}

/** Parse `scan`'s argv slice: optional positional <scope> + flags. */
export function parseScanArgs(argv: string[]): { args: ScanArgs | null; exitCode: number } {
  const out: ScanArgs = {
    scope: null, url: null, name: null, agent: null, model: null, cwd: null, maxBudgetUsd: null,
  };
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
    } else if (a === '--name' || a.startsWith('--name=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.name = r.v; i = r.i;
    } else if (a === '--agent' || a.startsWith('--agent=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.agent = r.v; i = r.i;
    } else if (a === '--model' || a.startsWith('--model=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.model = r.v; i = r.i;
    } else if (a === '--cwd' || a === '-C' || a.startsWith('--cwd=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 }; out.cwd = r.v; i = r.i;
    } else if (a === '--max-budget-usd' || a.startsWith('--max-budget-usd=')) {
      const r = takeValue(a, i); if (!r) return { args: null, exitCode: 2 };
      const n = Number(r.v);
      if (!Number.isFinite(n) || n <= 0) { err(`--max-budget-usd must be a positive number.`); return { args: null, exitCode: 2 }; }
      out.maxBudgetUsd = n; i = r.i;
    } else if (a.startsWith('-')) {
      err(`Unknown flag for scan: ${a}`);
      return { args: null, exitCode: 2 };
    } else if (out.scope === null) {
      out.scope = a;
    } else {
      err(`Unexpected extra argument: ${a} (quote the scope: hover scan "...")`);
      return { args: null, exitCode: 2 };
    }
  }
  return { args: out, exitCode: 0 };
}

// --- structural shapes of the dynamically-imported dist surfaces ---
interface LaunchOpts { port?: number; userDataDir?: string; url?: string; proxy?: { port: number; spki: string } }
type LaunchResult = { ok: true; alreadyRunning: boolean } | { ok: false; reason?: string };
interface McpConfigOpts {
  cdpUrl: string; port: number; cwd?: string; suffix?: string;
  extra?: { id: string; command: string; args?: string[]; env?: Record<string, string> }[];
}
interface RunSessionOpts {
  prompt: string; agentId: string; model?: string; cdpUrl?: string; cwd?: string;
  mcpConfig?: string; allowedToolsExtra?: string[]; appendSystemPrompt?: string; maxBudgetUsd?: number;
}
interface RunSessionResult { steps: unknown[]; summary: string; isError: boolean }
interface RunEvent { kind: string; text?: string; tool?: string; costUsd?: number; turns?: number }
interface SecurityRuntime {
  proxyPort: number; spki: string; mcpServerId: string; mcpScriptPath: string;
  mcpEnv: Record<string, string>; listChecks(): unknown[]; listGaps(): string[]; stop(): Promise<void>;
}
interface WriteReportOpts { devRoot: string; name: string; checks: unknown[]; notTested?: string[] }
