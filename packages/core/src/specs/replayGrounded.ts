import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

/*
 * Deterministic CREATION-VERIFICATION: replay a flow's grounded steps over CDP
 * in the already-open debug Chrome — no `playwright test`, no install, no auth
 * wall (the Stage-D self-test from the crystallization-fidelity work). A freshly
 * crystallized spec is "verified" if its grounded actions still resolve + run
 * against the live app. This is NOT the CI run (that's `playwright test` in the
 * user's CI) — it's the instant "did what I just wrote actually replay?" check.
 *
 * The grounded steps are the bare-tool actuations buffered by the MCP server's
 * grounded control tools (`click_control` / `fill_control` / `select_control` /
 * `check_control` / `assert_visible`). `groundedLocate` below is the canonical
 * role+name → testId → text resolver (the old extension's mcp/actuateServer.ts,
 * which once held a sibling copy, has been removed in the MCP-first cleanup).
 */

export interface GroundedTarget {
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  within?: { role?: string; name?: string };
}
type Ground = GroundedTarget;

export interface ReplayStep {
  kind?: string;
  tool?: string;
  input?: unknown;
}
export interface ReplayFailure {
  index: number;
  tool: string;
  target: string;
  error: string;
}
export interface ReplayResult {
  ok: boolean;
  /** Grounded actions that ran successfully. */
  ran: number;
  /** Total grounded actions in the flow. */
  total: number;
  failures: ReplayFailure[];
}

const ACTUATION_TOOLS = new Set(['click_control', 'fill_control', 'select_control', 'check_control', 'assert_visible']);
const ACTION_TIMEOUT = 8000;

function bare(tool?: string): string {
  if (!tool) return '';
  const p = tool.split('__');
  return p[0] === 'mcp' && p.length >= 3 ? p.slice(2).join('__') : tool;
}
function errLine(e: unknown): string {
  return e instanceof Error ? e.message.split('\n')[0] : String(e);
}
function originOf(u: string): string | null {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}
function describe(g: Ground): string {
  if (g.role && g.name) return `${g.role} "${g.name}"`;
  if (g.testId) return `testId "${g.testId}"`;
  if (g.text) return `text "${g.text}"`;
  return '(no target)';
}

// Mirrors mcp/actuateServer.ts `locate` — role+name → testId → text, optionally
// scoped to a `within` container. See file header. Exported so non-extension
// consumers (the replayer here, the standalone `hover-mcp`) share ONE grounded
// resolver without touching the load-bearing actuateServer.
export function groundedLocate(page: Page, g: GroundedTarget): Locator | null {
  const base =
    g.within?.role && g.within?.name
      ? page.getByRole(g.within.role as Parameters<Page['getByRole']>[0], { name: g.within.name, exact: true })
      : page;
  if (g.role && g.name) return base.getByRole(g.role as Parameters<Page['getByRole']>[0], { name: g.name, exact: true });
  if (g.testId) return base.getByTestId(g.testId);
  if (g.text) return base.getByText(g.text).first();
  return null;
}

/** Replay ONE grounded step on a page. Returns 'skipped' for non-actuation
 *  steps; throws on a failed locate / action (the caller records it). */
export async function applyGroundedStep(page: Page, step: ReplayStep): Promise<'ok' | 'skipped'> {
  const tool = bare(step.tool);
  if (!ACTUATION_TOOLS.has(tool)) return 'skipped';
  const input = (step.input ?? {}) as Ground & { value?: unknown; checked?: boolean };
  const loc = groundedLocate(page, input);
  if (!loc) throw new Error(`could not locate ${describe(input)}`);
  switch (tool) {
    case 'click_control':
      await loc.click({ timeout: ACTION_TIMEOUT });
      return 'ok';
    case 'fill_control':
      await loc.fill(String(input.value ?? ''), { timeout: ACTION_TIMEOUT });
      return 'ok';
    case 'select_control':
      await loc.selectOption(String(input.value ?? ''), { timeout: ACTION_TIMEOUT });
      return 'ok';
    case 'check_control':
      if (input.checked === false) await loc.uncheck({ timeout: ACTION_TIMEOUT });
      else await loc.check({ timeout: ACTION_TIMEOUT });
      return 'ok';
    case 'assert_visible': {
      const visible = await loc.first().isVisible();
      if (!visible) throw new Error(`${describe(input)} not visible`);
      return 'ok';
    }
    default:
      return 'skipped';
  }
}

/** Replay a flow's grounded steps on a given page (injected, so it's testable
 *  without a real browser). Navigates to `devUrl` first for a consistent start,
 *  then runs each grounded action, stopping at the first failure. */
export async function replayOnPage(page: Page, devUrl: string, steps: ReplayStep[]): Promise<ReplayResult> {
  const failures: ReplayFailure[] = [];
  let ran = 0;
  const total = steps.filter((s) => ACTUATION_TOOLS.has(bare(s.tool))).length;

  try {
    await page.goto(devUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    // SPA / already on the origin — replay anyway.
  }

  for (let i = 0; i < steps.length; i++) {
    if (!ACTUATION_TOOLS.has(bare(steps[i].tool))) continue;
    try {
      if ((await applyGroundedStep(page, steps[i])) === 'ok') ran++;
    } catch (e) {
      failures.push({ index: i, tool: bare(steps[i].tool), target: describe((steps[i].input ?? {}) as Ground), error: errLine(e) });
      break; // a broken step breaks the flow — stop here
    }
  }
  return { ok: failures.length === 0, ran, total, failures };
}

/** Pick the page on the dev origin, else the foreground page. */
async function pickPage(browser: Browser, devUrl: string): Promise<Page | null> {
  const wantOrigin = originOf(devUrl);
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages.length === 0) return null;
  const matches = wantOrigin ? pages.filter((p) => originOf(p.url()) === wantOrigin) : [];
  const candidates = matches.length ? matches : pages;
  let chosen = candidates[candidates.length - 1];
  for (const p of candidates) {
    try {
      if (await p.evaluate(() => document.visibilityState === 'visible')) {
        chosen = p;
        break;
      }
    } catch {
      /* busy/closed */
    }
  }
  return chosen;
}

/** Connect to the debug Chrome over CDP and replay a flow's grounded steps. */
export async function replayGroundedSteps(opts: { cdpUrl: string; devUrl: string; steps: ReplayStep[] }): Promise<ReplayResult> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(opts.cdpUrl, { timeout: 5000 });
  } catch (e) {
    return { ok: false, ran: 0, total: 0, failures: [{ index: -1, tool: 'connect', target: opts.cdpUrl, error: errLine(e) }] };
  }
  try {
    const page = await pickPage(browser, opts.devUrl);
    if (!page) {
      return { ok: false, ran: 0, total: 0, failures: [{ index: -1, tool: 'page', target: opts.devUrl, error: 'no page on the dev origin' }] };
    }
    return await replayOnPage(page, opts.devUrl, opts.steps);
  } finally {
    try {
      await browser.close();
    } catch {
      /* disconnect only — never kill the user's debug Chrome */
    }
  }
}
