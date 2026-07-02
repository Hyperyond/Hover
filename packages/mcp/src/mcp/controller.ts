import { request as pwRequest, type Page } from 'playwright-core';
import {
  groundedLocate,
  replayOnPage,
  type GroundedTarget,
  type SkillStep,
  type ApiCheck,
  type ReplayStep,
  type Redaction,
  type SharedFlow,
  type ExtractResult,
  type LintResult,
} from '@hover-dev/core/engine';

/*
 * The hover-mcp engine, decoupled from the MCP wire layer so it's testable with
 * a mock Page. The user's OWN agent (Claude Code / Cursor) calls these via MCP:
 * it reads the page (snapshot), actuates with GROUNDED targets (role+name →
 * testId → text), and Hover buffers each successful actuation as a SkillStep.
 * `crystallize` turns the buffer into a plain Playwright spec — record==replay,
 * because the buffered selectors ARE the ones that drove the page.
 *
 * API layer: while the agent drives the UI, Hover passively buffers the app's
 * xhr/fetch traffic off the SAME CDP connection (no MITM proxy). The agent reads
 * it with `capture_requests`, verifies a contract/authz check with
 * `replay_request`, and crystallizes the worthwhile ones into a
 * `*.api-test.spec.ts`. record == replay holds for the API layer too.
 */

export type FactType = 'business-rule' | 'expected-behavior' | 'validation' | 'access-policy';

/** A passively-observed xhr/fetch call (metadata + a light body shape). */
export interface CapturedRequest {
  method: string;
  url: string;
  status: number;
  contentType?: string;
  /** Request post data, truncated. */
  requestBody?: string;
  /** Top-level keys of a JSON response (a light shape hint). */
  responseKeys?: string[];
}

export interface McpDeps {
  /** Resolve the live page on the app under test (launch/connect lazily). */
  getPage: () => Promise<Page>;
  /** Write the buffered steps to a UI spec; returns the written path. `redactions`
   *  parameterize captured credentials into `process.env.<envVar>` refs (and let
   *  auth-fixture detect the login prefix). */
  crystallize: (
    name: string,
    description: string | undefined,
    steps: SkillStep[],
    redactions: Redaction[],
  ) => Promise<{ path: string }>;
  /** Write selected API checks to a `*.api-test.spec.ts`; returns the path. */
  crystallizeApi: (name: string, description: string | undefined, checks: ApiCheck[]) => Promise<{ path: string }>;
  /** Persist a learned business rule to .hover/memory/ (rules only — no secrets). */
  recordFact?: (title: string, rule: string, type: FactType) => Promise<{ path: string } | { error: string }>;
  /** Recall known business knowledge from .hover/memory/ ('' if none). Progressive:
   *  full bodies when the set is small, the index alone when it's large. */
  recall?: () => Promise<string>;
  /** Read ONE remembered rule's full text by name/slug (behind recall_fact), or
   *  null if nothing matches — the on-demand tier of progressive recall. */
  recallFact?: (name: string) => Promise<string | null>;
  /** Read a saved spec's recorded grounded steps (its `.hover/sidecars/<slug>.json`)
   *  so self-heal can replay them against the live app. */
  readSpecSteps?: (slug: string) => Promise<{ steps: SkillStep[]; startUrl?: string } | null>;
  /** Detect NON-login flows shared across saved specs (for the extract offer). */
  detectSharedFlows?: () => Promise<SharedFlow[]>;
  /** Lift shared flows into Page Objects + fold the specs that use them. */
  extractPageObjects?: () => Promise<ExtractResult>;
  /** Build the optimize (F7) brief for a spec — the improvement rules + the spec
   *  + its observed session + reusable Page Objects — for the user's OWN agent to
   *  work from. `{ error }` when the spec doesn't exist. No model runs. */
  optimizeBrief?: (slug: string) => Promise<{ prompt: string } | { error: string }>;
  /** File an agent-improved spec as a REVIEW candidate: validate it against the
   *  deterministic guardrails, soft-batch, and write `.hover/cache/optimized/
   *  <slug>.spec.ts.draft` (never the original). Throws if it fails validation. */
  saveOptimized?: (slug: string, code: string) => Promise<{ candidatePath: string }>;
  /** Promote a reviewed candidate: overwrite the real spec with its draft + drop
   *  the draft. The one place a candidate replaces the original — user-approved. */
  promoteOptimized?: (slug: string) => Promise<{ path: string }>;
  /** Deterministic health check over `.hover/`: map vs spec files vs run ledger. */
  lintWiki?: () => Promise<LintResult>;
}

function describe(g: GroundedTarget): string {
  if (g.role && g.name) return `${g.role} "${g.name}"`;
  if (g.testId) return `testId "${g.testId}"`;
  if (g.text) return `text "${g.text}"`;
  return '(no target)';
}

const MAX_CAPTURED = 200; // ring-buffer cap so a long run can't grow unbounded

export class HoverMcpController {
  /** The grounded-action buffer — sliced by `crystallize`. */
  readonly steps: SkillStep[] = [];
  /** Credentials typed into password fields — parameterized to process.env in
   *  the crystallized spec (never written literally) + used to detect the login
   *  prefix for auth-as-fixture. */
  private readonly redactions: Redaction[] = [];
  /** Passively-observed xhr/fetch traffic — read by `capture_requests`. */
  private readonly captured: CapturedRequest[] = [];
  /** Pages we've already attached a network listener to (avoid duplicates). */
  private readonly listening = new WeakSet<Page>();

  constructor(private readonly deps: McpDeps) {}

  private push(tool: string, input: unknown): void {
    this.steps.push({ kind: 'step', tool, input });
  }

  /** getPage + ensure the passive network listener is attached to it. */
  private async livePage(): Promise<Page> {
    const page = await this.deps.getPage();
    if (!this.listening.has(page)) {
      this.listening.add(page);
      page.on('response', (response) => {
        void this.onResponse(response).catch(() => {});
      });
    }
    return page;
  }

  private async onResponse(response: import('playwright-core').Response): Promise<void> {
    const req = response.request();
    const rt = req.resourceType();
    if (rt !== 'xhr' && rt !== 'fetch') return; // API calls only — skip docs/assets
    const contentType = (response.headers()['content-type'] || '').split(';')[0] || undefined;
    let responseKeys: string[] | undefined;
    if (contentType === 'application/json') {
      try {
        const body = await response.json();
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          responseKeys = Object.keys(body as Record<string, unknown>).slice(0, 24);
        }
      } catch {
        /* body unavailable / not JSON — metadata only */
      }
    }
    const post = req.postData();
    this.captured.push({
      method: req.method(),
      url: req.url(),
      status: response.status(),
      contentType,
      requestBody: post ? post.slice(0, 2000) : undefined,
      responseKeys,
    });
    if (this.captured.length > MAX_CAPTURED) this.captured.splice(0, this.captured.length - MAX_CAPTURED);
  }

  async navigate(url: string): Promise<string> {
    const page = await this.livePage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    this.push('browser_navigate', { url });
    return `navigated to ${url}`;
  }

  /** ARIA snapshot of the page — the agent reads role+name from here. */
  async snapshot(): Promise<string> {
    const page = await this.livePage();
    return await page.locator('body').ariaSnapshot();
  }

  private async resolve(g: GroundedTarget) {
    const page = await this.livePage();
    const loc = groundedLocate(page, g);
    if (!loc) throw new Error(`pass role+name (preferred), or testId, or text — taken from the snapshot`);
    return loc;
  }

  async click(g: GroundedTarget): Promise<string> {
    const loc = await this.resolve(g);
    await loc.click({ timeout: 8000 });
    this.push('click_control', g);
    return `✓ clicked ${describe(g)}`;
  }

  async fill(g: GroundedTarget, value: string): Promise<string> {
    const loc = await this.resolve(g);
    await loc.fill(value, { timeout: 8000 });
    this.push('fill_control', { ...g, value });
    // A value typed into a password field is a secret: parameterize it to
    // process.env so it never lands literally in the spec/sidecar, and so
    // auth-as-fixture can detect this fill as part of the login prefix.
    if (value) {
      let isPassword = false;
      try {
        isPassword = (await loc.getAttribute('type')) === 'password';
      } catch {
        /* locator has no getAttribute (test mock) or field gone — treat as non-secret */
      }
      if (isPassword && !this.redactions.some((r) => r.value === value)) {
        this.redactions.push({ value, envVar: 'HOVER_PASSWORD' });
      }
    }
    return `✓ filled ${describe(g)}`;
  }

  async select(g: GroundedTarget, value: string): Promise<string> {
    const loc = await this.resolve(g);
    await loc.selectOption(value, { timeout: 8000 });
    this.push('select_control', { ...g, value });
    return `✓ selected ${value} in ${describe(g)}`;
  }

  async check(g: GroundedTarget, checked: boolean): Promise<string> {
    const loc = await this.resolve(g);
    if (checked) await loc.check({ timeout: 8000 });
    else await loc.uncheck({ timeout: 8000 });
    this.push('check_control', { ...g, checked });
    return `✓ ${checked ? 'checked' : 'unchecked'} ${describe(g)}`;
  }

  async assertVisible(g: GroundedTarget): Promise<string> {
    const loc = await this.resolve(g);
    const visible = await loc.first().isVisible();
    if (!visible) throw new Error(`${describe(g)} is not visible`);
    this.push('assert_visible', { ...g, matcher: 'visible' });
    return `✓ ${describe(g)} is visible`;
  }

  /** Return the passively-observed xhr/fetch traffic (optionally filtered) as
   *  JSON for the agent to reason over when deciding API checks. */
  captureRequests(filter?: { urlContains?: string; method?: string }): string {
    let rows = this.captured;
    if (filter?.urlContains) rows = rows.filter((r) => r.url.includes(filter.urlContains!));
    if (filter?.method) rows = rows.filter((r) => r.method.toUpperCase() === filter.method!.toUpperCase());
    if (rows.length === 0) {
      return 'No xhr/fetch traffic captured yet. Drive the app (navigate / click) so its API calls fire, then call this again.';
    }
    return JSON.stringify(rows.slice(-60), null, 2);
  }

  /** Send a (possibly mutated) request and return the response summary — the
   *  API analogue of replaying a grounded step, so an authz/contract check is
   *  VERIFIED against the live app before it's crystallized (no confabulation).
   *  `authenticated` (default true) replays with the browser session's cookies;
   *  false uses a fresh context (no session) for "requires auth" checks. */
  async replayRequest(opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    authenticated?: boolean;
  }): Promise<string> {
    const page = await this.livePage();
    const authed = opts.authenticated !== false;
    const ctx = authed ? page.context().request : await pwRequest.newContext();
    try {
      const m = opts.method.toUpperCase();
      const reqOpts: { headers?: Record<string, string>; data?: unknown } = {};
      if (opts.headers) reqOpts.headers = opts.headers;
      if (opts.body !== undefined && m !== 'GET' && m !== 'HEAD') reqOpts.data = opts.body;
      const res = await ctx.fetch(opts.url, { method: m, ...reqOpts });
      const contentType = (res.headers()['content-type'] || '').split(';')[0] || '';
      let preview = '';
      try {
        preview = contentType === 'application/json' ? JSON.stringify(await res.json()).slice(0, 800) : (await res.text()).slice(0, 400);
      } catch {
        /* no body */
      }
      return JSON.stringify({ status: res.status(), ok: res.ok(), contentType, body: preview, authenticated: authed }, null, 2);
    } finally {
      if (!authed) await ctx.dispose();
    }
  }

  /** Recall what earlier runs learned about this app's business rules. Progressive:
   *  a large memory comes back as an INDEX; use recallFact to pull one rule's body. */
  async recall(): Promise<string> {
    if (!this.deps.recall) return 'No business memory available.';
    const known = await this.deps.recall();
    return known || 'No business knowledge recorded yet for this app.';
  }

  /** Read one remembered rule's full text by name (the on-demand tier — used when
   *  recall returned only the index and the agent needs a specific rule's body). */
  async recallFact(name: string): Promise<string> {
    if (!this.deps.recallFact) return 'Rule lookup unavailable in this server.';
    const body = await this.deps.recallFact(name);
    return body ?? `No remembered rule matches "${name}". Call recall_business_knowledge to see the index of known rules.`;
  }

  /** Persist a confirmed business RULE so future runs don't re-ask it. Rules
   *  only — never secrets / credentials / PII. */
  async recordFact(title: string, rule: string, type: FactType = 'business-rule'): Promise<string> {
    if (!this.deps.recordFact) return 'Memory channel unavailable; continuing.';
    const res = await this.deps.recordFact(title, rule, type);
    return 'error' in res ? `✗ could not save fact: ${res.error}` : `✓ remembered: ${title}`;
  }

  /** Crystallize the buffered UI flow → a plain Playwright spec, then clear the
   *  buffer for the next flow. */
  async crystallize(name: string, description?: string): Promise<string> {
    if (this.steps.length === 0) return 'Nothing to crystallize yet — actuate some controls first.';
    const flow = [...this.steps];
    const { path } = await this.deps.crystallize(name, description, flow, [...this.redactions]);
    this.steps.length = 0;
    return `✓ wrote ${path} (${flow.length} step${flow.length === 1 ? '' : 's'})`;
  }

  /** Crystallize agent-selected API checks → a `*.api-test.spec.ts`. The agent
   *  decides WHICH calls are worth locking (a real contract / authz boundary),
   *  not every captured request. */
  async crystallizeApiSpec(name: string, description: string | undefined, checks: ApiCheck[]): Promise<string> {
    if (!checks?.length) return 'No checks provided — pass the API checks you verified worth locking.';
    const { path } = await this.deps.crystallizeApi(name, description, checks);
    return `✓ wrote ${path} (${checks.length} check${checks.length === 1 ? '' : 's'})`;
  }

  /** Self-heal detection: replay a saved spec's RECORDED grounded steps against
   *  the live app and report the first step that no longer locates — the drift
   *  point the agent re-grounds. No `playwright test`, no install; the same
   *  grounded replay as creation-verification, seeded from the spec's sidecar. */
  async replaySpec(slug: string): Promise<string> {
    if (!this.deps.readSpecSteps) return 'Spec replay unavailable in this server.';
    const sc = await this.deps.readSpecSteps(slug);
    if (!sc) {
      return `No sidecar for "${slug}" — only Hover-crystallized specs can be replayed (looked for .hover/sidecars/${slug}.json).`;
    }
    const page = await this.livePage();
    const devUrl = sc.startUrl ?? page.url();
    const res = await replayOnPage(page, devUrl, sc.steps as ReplayStep[]);
    if (res.ok) {
      return `✓ "${slug}" still replays clean — ${res.ran}/${res.total} grounded steps located. No drift to heal.`;
    }
    const f = res.failures[0];
    return JSON.stringify(
      {
        spec: slug,
        drifted: true,
        ranBeforeBreak: res.ran,
        total: res.total,
        brokeAtStep: f.index,
        tool: f.tool,
        lookingFor: f.target,
        error: f.error,
        next: 'Re-snapshot at this point, re-locate the control by the intent in "lookingFor" (its label/role may have changed), re-drive from here, then crystallize_spec with the SAME name to overwrite the healed spec.',
      },
      null,
      2,
    );
  }

  /** LLM-Wiki P1 Lint: run the deterministic `.hover/` health check (map vs
   *  specs vs runs) and return it as a readable report the agent acts on (heal a
   *  regressed line, map an orphan spec, drop a dead ref). The LLM-judged checks
   *  (contradictory rules, code routes missing from the map) are driven on top of
   *  this by the /mcp__hover__lint prompt. */
  async lintWiki(): Promise<string> {
    if (!this.deps.lintWiki) return 'Wiki lint is unavailable in this server.';
    const res = await this.deps.lintWiki();
    if (!res.hasMap) {
      return 'No .hover/hover-map.md yet — nothing to lint. Run /mcp__hover__test_app first to map the app and crystallize specs.';
    }
    const { areas, lines, covered, specs } = res.summary;
    const head = `Wiki lint — ${covered}/${lines} lines covered across ${areas} area${areas === 1 ? '' : 's'}, ${specs} spec file${specs === 1 ? '' : 's'}.`;
    if (res.findings.length === 0) {
      return `${head}\n✓ No drift: every mapped spec exists, no covered line is failing, no spec is unmapped.`;
    }
    const icon = { error: '✗', warn: '⚠', info: '·' } as const;
    const body = res.findings
      .map((f) => `${icon[f.severity]} [${f.kind}] ${f.message}${f.fix ? `\n   → ${f.fix}` : ''}`)
      .join('\n');
    return `${head}\n${res.findings.length} finding${res.findings.length === 1 ? '' : 's'}:\n${body}`;
  }

  /** Report NON-login flows repeated across the saved specs — so the agent can
   *  ASK the user whether to lift them into a shared Page Object. Read-only. */
  async detectSharedFlows(): Promise<string> {
    if (!this.deps.detectSharedFlows) return 'Shared-flow detection unavailable in this server.';
    const flows = await this.deps.detectSharedFlows();
    if (!flows.length) {
      return 'No extractable shared flows — no set of specs shares a non-login entry flow (login is already handled by the auth setup). Nothing to lift.';
    }
    return JSON.stringify(
      flows.map((f) => ({ sharedBy: f.specs, steps: f.prose })),
      null,
      2,
    );
  }

  /** Optimize (F7), MCP-first: return the improvement brief for the user's own
   *  agent to work from (the agent IS the model — Hover picks none). Never
   *  throws; a missing spec / unavailable channel comes back as a plain message
   *  the agent reads (this feeds a PROMPT, which isn't wrapped in the ✗ guard). */
  async optimizeBrief(slug: string): Promise<string> {
    if (!this.deps.optimizeBrief) return `Optimize is unavailable in this server (heal/optimize need spec sidecars).`;
    try {
      const res = await this.deps.optimizeBrief(slug);
      if ('error' in res) {
        return `Can't optimize "${slug}": ${res.error}. Optimize only works on a Hover-crystallized spec — list __vibe_tests__/*.spec.ts and pass one by slug.`;
      }
      return res.prompt;
    } catch (e) {
      return `Can't build the optimize brief for "${slug}": ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
    }
  }

  /** File an agent-improved spec as a review candidate. Validation failures throw
   *  (the tool guard turns them into a ✗ the agent can fix and retry against). */
  async saveOptimized(slug: string, code: string): Promise<string> {
    if (!this.deps.saveOptimized) return 'Optimize is unavailable in this server.';
    const { candidatePath } = await this.deps.saveOptimized(slug, code);
    return `✓ filed optimized candidate at ${candidatePath} (your spec is untouched). Show the user the diff vs __vibe_tests__/${slug}.spec.ts; if they approve, call promote_optimized_spec("${slug}") to apply it (or they can review + promote in the VS Code cockpit).`;
  }

  /** Apply a reviewed candidate over the real spec (user-approved). */
  async promoteOptimized(slug: string): Promise<string> {
    if (!this.deps.promoteOptimized) return 'Optimize is unavailable in this server.';
    const { path } = await this.deps.promoteOptimized(slug);
    return `✓ promoted the candidate → ${path} (draft removed). Run it to confirm: npx playwright test ${path}`;
  }

  /** Lift the detected shared flows into `pages/*` + `fixtures.ts` and fold the
   *  specs that use them. Call ONLY after the user approves (detectSharedFlows
   *  → ask → this). Deterministic; login flows are excluded (auth-fixture owns). */
  async extractPageObjects(): Promise<string> {
    if (!this.deps.extractPageObjects) return 'Page Object extraction unavailable in this server.';
    const res = await this.deps.extractPageObjects();
    if (!res.pages.length) return 'Nothing to extract — no shared non-login flow found.';
    return `✓ lifted ${res.pages.length} Page Object${res.pages.length === 1 ? '' : 's'} (${res.pages
      .map((p) => p.className)
      .join(', ')}) into __vibe_tests__/pages + fixtures.ts; folded ${res.folded.length} spec${
      res.folded.length === 1 ? '' : 's'
    } (${res.folded.join(', ')}) to consume them.`;
  }
}
