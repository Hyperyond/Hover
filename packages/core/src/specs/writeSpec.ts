/**
 * Save a completed Hover session as a standard Playwright spec.
 *
 * Writes a `.spec.ts` file under `<devRoot>/__vibe_tests__/`. The generated
 * file imports only `@playwright/test` — no Hover runtime, no agent in the
 * loop. The dev project's playwright.config.ts is expected to set
 * `baseURL` so the spec can use relative URLs (matches the dogfood spec).
 *
 * Translation strategy is deterministic, not LLM. Each `browser_*` tool call
 * in the captured session maps to one Playwright call. Element descriptions
 * coming back from Playwright MCP (e.g. "Submit button", "+1 button") are
 * parsed for role + accessible name and emitted as `getByRole(role, { name })`
 * — Hover's official preference because those selectors survive markup
 * changes that don't touch semantics.
 *
 * Assertions (future "Assert This" feature) layer in via the optional
 * `assertions` field on the input.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillStep } from '../specs/specStep.js';
import { humanSteps, humanStep } from './humanSteps.js';
import { writeSidecar } from './sidecar.js';
import {
  readPageObjectManifest,
  type PageObjectEntry,
  type PageObjectManifest,
} from './pageObjectManifest.js';
import { stepSignature } from './detectSharedFlows.js';
import { slugify, firstSentence } from './text.js';
import { markSessionSaved } from '../sessions/sessions.js';
import { authPrefixLength, addSetupProjectToConfig } from './authFixture.js';

export type SpecStep = SkillStep;

/**
 * Marker the deterministic translator leaves where a captured action is a real
 * interaction but has no single-step Playwright translation (e.g. file upload,
 * drag, a dialog handler) — a shape that needs a multi-step pattern. It is a
 * structured signal, not a `// TODO`: the optimization pass (F7) and the
 * "seeds could complete this — review?" suggestion grep for it, and
 * `countOptimizableMarkers` reads it back off a saved spec.
 */
export const OPTIMIZABLE_MARKER = '// hover:optimizable';

/** How many `// hover:optimizable` markers a generated spec carries. Used to
 *  surface "this spec has an interaction the deterministic pass couldn't fully
 *  translate — the optimization pass can complete it". */
export function countOptimizableMarkers(source: string): number {
  return source.split('\n').filter(l => l.trimStart().startsWith(OPTIMIZABLE_MARKER)).length;
}

/** Strip the `mcp__<server>__` prefix off a Hover-MCP tool name. The server
 *  segment is kebab-case (`hover-source`), so the class includes `-`; lazy so
 *  the tool name (which may contain `_`) is preserved. */
function bareTool(rawTool: string): string {
  return rawTool.replace(/^mcp__[a-z0-9_-]+?__/, '');
}

/** Tools that never belong in a crystallized spec: read-only exploration the
 *  agent does to understand the page/code, and meta interactions like asking
 *  the user a question. Dropped at the filter so they don't reach the body or
 *  the prose. (browser_* read tools are also dropped inside translateStep.) */
function isExploratoryTool(rawTool: string): boolean {
  const tool = bareTool(rawTool);
  // take_screenshot is the grounded-mode viewport screenshot (perceive-only,
  // like browser_take_screenshot) — never a replayable spec step.
  return tool === 'list_source' || tool === 'read_source' || tool === 'ask_user' || tool === 'take_screenshot';
}

/**
 * Dirty-recording cleanup. An agent run is exploratory: it makes failed
 * attempts and reads source to orient itself. Those are captured as steps (and
 * kept in the sidecar), but the runnable spec must reflect only
 * the working flow. Drop step-kind entries that errored or are pure
 * exploration; keep everything else (user/done/ai markers and successful
 * actions) untouched. Returns the filtered steps plus how many were omitted.
 */
function filterDirtySteps(steps: SpecStep[]): { clean: SpecStep[]; omitted: number } {
  let omitted = 0;
  const clean = steps.filter(s => {
    if (s.kind !== 'step' || !s.tool) return true; // non-action entries pass through
    if (isFlowMarker(s)) return false; // mark_flow is a split boundary, not an action — drop, don't count
    // record_candidate is a QA capture signal, not a replayable browser action —
    // drop it (silently, like mark_flow) so it never renders as a junk
    // `hover:optimizable` step in the crystallized spec.
    if (bareTool(s.tool) === 'record_candidate') return false;
    if (s.isError || isExploratoryTool(s.tool)) { omitted++; return false; }
    return true;
  });
  return { clean, omitted };
}

export interface SpecAssertion {
  /** Generated Playwright code (single line, no leading "await "). */
  code: string;
  /** Short human description for the spec comments. */
  hint?: string;
}

export class SpecExistsError extends Error {
  constructor(public readonly slug: string, public readonly path: string) {
    super(`Playwright spec "${slug}" already exists at ${path}`);
    this.name = 'SpecExistsError';
  }
}

/**
 * A credential to keep out of the generated spec. The deterministic translator
 * replaces any fill value that exactly equals `value` with a
 * `process.env.<envVar>` reference — so the literal password/username never
 * lands in the spec source, the JSDoc header, OR the `.hover/` sidecar. The
 * value comes from the caller (the editor resolves an `@account` mention from
 * its vault); core only uses it to match-and-replace, never to write.
 */
export interface Redaction {
  value: string;
  envVar: string;
}

export interface WriteSpecOptions {
  devRoot: string;
  name: string;
  description?: string;
  steps: SpecStep[];
  assertions?: SpecAssertion[];
  overwrite?: boolean;
  /** Credentials to parameterize into `process.env.<envVar>` references. */
  redactions?: Redaction[];
  /** The run's target URL (the active environment / dev origin). Used to
   *  guarantee the spec opens the app: if the captured session has NO
   *  navigation (the agent connected to an already-open tab and never called
   *  browser_navigate), a leading `page.goto()` is synthesized from this, and
   *  it's the fallback origin for the scaffolded playwright config. */
  startUrl?: string;
  /** Recon-discovered reset recipe for the run's environment (debt-2 reproducible
   *  state isolation). When tier 1, a shared `support/resetState.ts` helper is
   *  generated and called in a `beforeEach` so the spec re-enters from a clean
   *  client state every run. Tier 2/3 (backend-state) emit no reset here. (Engine
   *  shape, decoupled from the extension's ResetRecipe — only tier/keys matter.) */
  resetRecipe?: { tier: number; storageKeys?: string[]; hook?: string };
  /** Auth-as-fixture (debt 3): engage the fixture EVEN WHEN a user playwright.config
   *  already exists — i.e. the user approved Hover editing their config (Stage 4).
   *  Without it, an existing config keeps login inline (Hover never edits a user's
   *  config unprompted). When true, writeSpec also applies the setup-project edit
   *  to the config. No effect when no login prefix is detected. */
  authFixture?: boolean;
}

/** Stored-step form of a redacted credential — a code expression, so it both
 *  renders as `fill(process.env.X ?? '')` and survives JSON (the sidecar)
 *  without ever holding the secret. */
function envExpr(envVar: string): string {
  return `process.env.${envVar} ?? ''`;
}

/** Replace credential fill values with `process.env.<envVar>` expressions,
 *  ONCE, before both rendering and sidecar persistence. Pure — clones touched
 *  steps, leaves the rest untouched. */
function redactSteps(steps: SpecStep[], redactions: Redaction[]): SpecStep[] {
  const map = new Map(redactions.filter(r => r.value).map(r => [r.value, r.envVar]));
  if (map.size === 0) return steps;
  return steps.map(s => {
    if (s.kind !== 'step' || !s.input) return s;
    const input = s.input as Record<string, unknown>;
    // Match on the BARE tool name — grounded fills arrive as
    // `mcp__hover-control__fill_control`, playwright ones as bare `browser_type`.
    const tool = (s.tool ?? '').replace(/^mcp__[a-z0-9_-]+?__/, '');
    // A single typed/filled value: browser_type uses `text`, the grounded
    // fill_control uses `value`. WITHOUT the fill_control case, credentials typed
    // via grounded actuation (the default mode) leaked into the spec unredacted.
    const valueKey = tool === 'browser_type' ? 'text' : tool === 'fill_control' ? 'value' : null;
    if (valueKey && typeof input[valueKey] === 'string' && map.has(input[valueKey] as string)) {
      return { ...s, input: { ...input, [valueKey]: envExpr(map.get(input[valueKey] as string)!) } };
    }
    if (tool === 'browser_fill_form' && Array.isArray(input.fields)) {
      let changed = false;
      const fields = (input.fields as Array<Record<string, unknown>>).map(f => {
        if (f && typeof f.value === 'string' && map.has(f.value)) {
          changed = true;
          return { ...f, value: envExpr(map.get(f.value as string)!) };
        }
        return f;
      });
      if (changed) return { ...s, input: { ...input, fields } };
    }
    return s;
  });
}

/** Render a fill value: a redacted `process.env.…` expression emits as CODE;
 *  anything else as a string literal. */
function renderFillValue(value: string): string {
  return /^process\.env\b/.test(value) ? value : JSON.stringify(value);
}

export interface WriteSpecResult {
  /** Primary written file (the first flow when split, else the single spec). */
  path: string;
  slug: string;
  /** Every file written — one per `mark_flow` feature when the run was split. */
  files: { path: string; slug: string; flow: string }[];
  /** Auth-as-fixture (debt 3, Stage 4): a login was detected but a USER
   *  playwright.config already exists, so Hover left login inline rather than
   *  edit their config unprompted. This is the proposed edit to offer for
   *  approval — on approval the caller re-saves with `authFixture: true`, which
   *  applies it. Absent when there's no login, no user config, or the config
   *  can't be safely edited (already has `projects`). */
  authFixtureOffer?: { configPath: string; proposedConfig: string };
}

/** True for a `mark_flow` boundary step (the agent's per-feature split marker).
 *  Matches the raw tool name with or without the `mcp__<server>__` prefix. */
function isFlowMarker(s: SpecStep): boolean {
  return s.kind === 'step' && /(^|__)mark_flow$/.test(String((s as { tool?: string }).tool ?? ''));
}

export async function writeSpec(opts: WriteSpecOptions): Promise<WriteSpecResult> {
  if (!slugify(opts.name)) throw new Error('spec name must contain at least one alphanumeric character');
  if (!opts.steps.some((s) => s.kind === 'step' && !isFlowMarker(s))) {
    throw new Error('spec must contain at least one tool step to replay');
  }

  // One run → one file. Frontend runs are NOT auto-split: a single user journey
  // (especially a multi-step single-page form) is stateful and sequential — each
  // step depends on the prior steps' state, so chopping it into per-section files
  // yields fragments that each fail when run standalone. Splitting into truly
  // independent journeys is a deliberate refactor (the architecture pass), not
  // something the agent improvises mid-run. (API checks ARE split by module in
  // writeSecuritySpec — those are stateless and independently replayable.)
  return writeOneSpec(opts, slugify(opts.name), opts.name, opts.steps);
}

/** Write ONE spec file from a (sub)set of steps. The single-file path and each
 *  per-flow file both go through here, so rendering / sidecar / config logic is
 *  identical whether or not the run was split. */
async function writeOneSpec(
  opts: WriteSpecOptions,
  slug: string,
  displayName: string,
  rawSteps: SpecStep[],
): Promise<WriteSpecResult> {
  if (!slug) throw new Error('spec name must contain at least one alphanumeric character');
  const dir = join(opts.devRoot, '__vibe_tests__');
  const path = join(dir, `${slug}.spec.ts`);

  if (!opts.overwrite && existsSync(path)) {
    throw new SpecExistsError(slug, path);
  }

  await mkdir(dir, { recursive: true });
  // Redact credentials ONCE, up front, so every downstream artifact (spec
  // source, JSDoc header, sidecar) sees only `process.env.…` references — the
  // literal password/username is never written anywhere.
  const steps = redactSteps(rawSteps, opts.redactions ?? []);
  // Stage 3c: if a prior extraction left a Page Object whose flow prefixes
  // this spec, consume it (await loginPage.login(…)) instead of re-emitting
  // the steps inline. No manifest (extraction never ran) → plain spec.
  // Dirty-recording cleanup: the agent's failed attempts (isError) and
  // read-only exploration (list_source / read_source) are real captured steps
  // but must NOT land in the runnable spec — only the working flow should. They
  // stay in `steps` (hence the sidecar) as the full-fidelity record the
  // optimization pass reads; the spec renders from the filtered view, with a
  // JSDoc note of how many were omitted.
  const { clean: cleanSteps, omitted } = filterDirtySteps(steps);
  const manifest = await readPageObjectManifest(opts.devRoot);
  let match = manifest ? matchPageObject(cleanSteps, manifest) : null;
  // Auth-as-fixture (debt 3): when the recorded login is detectable (credentials
  // were redacted to process.env refs), lift it into auth.setup.ts and start
  // specs authenticated via storageState — login then runs ONCE, not per test.
  // Auto-on is gated to the scaffold case: with NO existing playwright.config we
  // write one that registers the setup project, so it's self-contained. With an
  // existing user config we can't register the setup project without editing
  // their file (the Stage-4 approval flow), so keep today's inline login there.
  const cleanActions = cleanSteps.filter(s => s.kind === 'step' && !!s.tool);
  const envVars = (opts.redactions ?? []).map(r => r.envVar);
  const detectedPrefix = authPrefixLength(cleanActions, envVars);
  const userConfigName = PLAYWRIGHT_CONFIG_NAMES.find(n => existsSync(join(opts.devRoot, n)));
  // Already opted in: auth.setup.ts exists from a prior approval (and the config
  // already registers it), so engage AUTOMATICALLY — don't re-ask or re-edit.
  const authSetupExists = existsSync(join(dir, 'auth.setup.ts'));
  // Engage the fixture when a login is detected AND we can register the setup
  // project: we scaffold the config (no user config), the caller approved editing
  // it (opts.authFixture, Stage 4), or the fixture was already set up earlier.
  const engage = detectedPrefix > 0 && (!userConfigName || opts.authFixture === true || authSetupExists);
  const authPrefix = engage ? detectedPrefix : 0;
  const authFile = engage ? AUTH_STATE_FILE : undefined;
  let authFixtureOffer: WriteSpecResult['authFixtureOffer'];
  if (authFile) {
    // Login lifted to setup.ts → a login Page Object fold would double it up.
    match = null;
    try {
      await writeFile(
        join(dir, 'auth.setup.ts'),
        renderAuthSetup(cleanActions.slice(0, authPrefix), authFile, opts.startUrl),
        'utf-8',
      );
    } catch { /* auth.setup generation is best-effort, never breaks Save */ }
    // Approved edit to an EXISTING user config → register the setup project.
    if (userConfigName && opts.authFixture) {
      try {
        const p = join(opts.devRoot, userConfigName);
        const edited = addSetupProjectToConfig(readFileSync(p, 'utf-8'));
        if (edited) await writeFile(p, edited, 'utf-8');
      } catch { /* config edit is best-effort; the spec still has the paste hint */ }
    }
  } else if (detectedPrefix > 0 && userConfigName && !opts.authFixture) {
    // Login detected but a user config exists and edit wasn't approved → keep
    // login inline, and surface the proposed config edit for the UI to offer.
    try {
      const proposed = addSetupProjectToConfig(readFileSync(join(opts.devRoot, userConfigName), 'utf-8'));
      // Absolute path so the extension can read the file directly (for the diff
      // preview) without knowing the project root.
      if (proposed) authFixtureOffer = { configPath: join(opts.devRoot, userConfigName), proposedConfig: proposed };
    } catch { /* offer is best-effort */ }
  }
  // Debt-2: a Tier-1 (client-resettable) recipe → generate the shared
  // resetState() helper and call it in a beforeEach so the spec re-enters from a
  // clean state every run. Tier 2/3 emit no reset (backend state isn't
  // client-resettable). Best-effort: helper generation must never break Save.
  const emitReset = opts.resetRecipe?.tier === 1;
  if (emitReset) {
    try { await ensureResetStateHelper(opts.devRoot, opts.resetRecipe!.storageKeys ?? []); }
    catch { /* helper generation is best-effort */ }
  }
  const source = renderSpec(slug, displayName, opts.description ?? '', cleanSteps, opts.assertions ?? [], match, omitted, opts.startUrl, emitReset, authPrefix, authFile);
  await writeFile(path, source, 'utf-8');
  // Specs use relative URLs (page.goto("/")), which need a `baseURL` in the
  // project's Playwright config. If the project has NO config at all, the saved
  // spec fails on the first goto with "Cannot navigate to invalid URL" — which
  // breaks Hover's core promise that the saved artifact is plain Playwright that
  // just runs. Scaffold a minimal config in that case. Best-effort: it must
  // never break Save-as-spec, and it never overwrites an existing config.
  try {
    await ensurePlaywrightConfig(opts.devRoot, steps, opts.startUrl, authFile);
  } catch { /* config scaffolding is best-effort */ }
  // Persist the structured session next to the spec so cross-session
  // extraction (F4) and the optimization pass (F7) read real SpecStep[]
  // instead of parsing the generated code. Lands in .hover/, which
  // Playwright's *.spec.ts glob never collects.
  await writeSidecar(opts.devRoot, {
    slug,
    name: displayName,
    steps,
    assertions: opts.assertions ?? [],
  });
  // Session-ledger patch, best-effort by contract: markSessionSaved swallows
  // its own failures — it must never break Save-as-spec.
  const promptText = rawSteps.find(s => s.kind === 'user')?.text;
  if (promptText) await markSessionSaved(opts.devRoot, promptText, slug);
  return { path, slug, files: [{ path, slug, flow: displayName }], authFixtureOffer };
}

// Escape sequences that would prematurely terminate the JSDoc block.
// (Backtick literal of close-comment sequence omitted on purpose — see how
// the regex below is built — to avoid recursively poisoning *this* file.)
function jsdocEscape(s: string): string {
  return s.replace(/\*\//g, '*\\/');
}

/**
 * Turn the captured assertions (Alt-click "Assert This") and the agent's
 * final summary into bullet lines for the Expected: block.
 *
 * Assertions take priority — they're the developer's explicit "this is
 * what success looks like". When there are none, fall back to the
 * agent's natural-language done-summary (single first sentence) so the
 * block still carries something readable for QA.
 */
function collectExpected(
  assertions: SpecAssertion[],
  doneSummary: string | undefined,
): string[] {
  if (assertions.length > 0) {
    return assertions.map(a => a.hint ?? a.code);
  }
  if (doneSummary && doneSummary.trim()) {
    // Take the first sentence only — agents sometimes ramble.
    return [firstSentence(doneSummary)];
  }
  return [];
}

function renderSpec(
  slug: string,
  displayName: string,
  description: string,
  steps: SpecStep[],
  assertions: SpecAssertion[],
  match: PageObjectMatch | null,
  omitted = 0,
  startUrl?: string,
  emitReset = false,
  // Auth-as-fixture: number of leading ACTION steps that form the login flow
  // (lifted into auth.setup.ts) and the storageState path the spec reuses. When
  // authFile is set, the login prefix is skipped from the body and the spec
  // starts already authenticated via `test.use({ storageState })`.
  authPrefix = 0,
  authFile?: string,
): string {
  const userMsg = steps.find(s => s.kind === 'user');
  const doneMsg = [...steps].reverse().find(s => s.kind === 'done');

  // Plain-English step + expected blocks for the JSDoc header. QA / PMs
  // can read these without grokking the Playwright API.
  const proseSteps = humanSteps(steps);
  const expectedLines = collectExpected(assertions, doneMsg?.summary);

  // ── Walk the steps into the test body first, so we know whether any F6
  //    popup pairing needs the `context` fixture before we write the
  //    signature. Each step becomes one `test.step(...)` (Given/When/Then by
  //    position) so Playwright's HTML report reads as named stages. ──
  const body: string[] = [];
  let sawInteraction = false;
  let sigSeen = 0;
  let emittedPageObject = false;
  let pageVar = 'page';
  let popupCount = 0;
  let usesContext = false;

  // Auth-as-fixture: drop the leading login steps from the business spec — they
  // run once in auth.setup.ts, and `test.use({ storageState })` (added below)
  // makes this spec start authenticated. Slicing keeps the popup/tab-pairing
  // logic below operating on the business flow only.
  const allActions = steps.filter(s => s.kind === 'step' && !!s.tool);
  const actions = authFile && authPrefix > 0 ? allActions.slice(authPrefix) : allActions;
  for (let i = 0; i < actions.length; i++) {
    const s = actions[i];
    const next = actions[i + 1];

    // Stage 3c: fold the matched login/entry prefix into one Page Object call.
    if (match && sigSeen < match.consumedSigs && stepSignature(s.tool!, s.input) != null) {
      sigSeen++;
      if (!emittedPageObject) {
        pushTestStep(body, `Given · ${match.entry.methodName}`,
          [`await ${match.entry.fixtureName}.${match.entry.methodName}(${match.args.join(', ')});`]);
        emittedPageObject = true;
        sawInteraction = true;
      }
      continue;
    }

    // F6: a click that opens a new tab, immediately followed by a tab switch →
    // pair them into Promise.all([context.waitForEvent('page'), …click()]) and
    // re-target subsequent steps onto the new page. No visibility prelude on
    // the click — the open must race the waitForEvent, not await visibility.
    if (isPopupClick(s) && next && isTabSelectNew(next)) {
      usesContext = true;
      popupCount += 1;
      const newVar = popupCount === 1 ? 'newPage' : `newPage${popupCount}`;
      const clickSel = selectorFromDescription(
        String((s.input as Record<string, unknown>).element ?? ''), pageVar);
      pushTestStep(body, `When · ${humanStep(s.tool!, s.input) ?? s.tool!}`, [
        `const [${newVar}] = await Promise.all([`,
        `  context.waitForEvent('page'),`,
        `  ${clickSel}.click(),`,
        `]);`,
      ]);
      pageVar = newVar;
      sawInteraction = true;
      i++; // also consume the paired tab-switch step
      continue;
    }

    // A standalone tab switch back to the original tab → re-target to `page`.
    if (s.tool === 'browser_tabs') {
      if (isTabSelectOriginal(s)) pageVar = 'page';
      continue; // tab switches don't emit a line of their own
    }

    const bodyLines = translateStep(s.tool!, s.input, pageVar);
    if (bodyLines.length === 0) continue; // diagnostic / non-replayable
    const phase = !sawInteraction && s.tool === 'browser_navigate' ? 'Given' : 'When';
    pushTestStep(body, `${phase} · ${humanStep(s.tool!, s.input) ?? s.tool!}`, bodyLines);
    if (s.tool !== 'browser_navigate') sawInteraction = true;
  }

  // Guarantee the spec opens the app. The agent often connects to an
  // already-open debug-Chrome tab and never calls browser_navigate, so the
  // captured session can lack any navigation — a spec with no page.goto() runs
  // against about:blank and every locator fails. When no navigation was
  // captured, synthesize a leading goto from the run's target URL.
  // Check the BUSINESS actions (login prefix already sliced out): when auth was
  // lifted to setup.ts, its navigate goes with it, so the spec must synthesize
  // its own goto to land on the (now authenticated) app.
  const hasNavigate = actions.some(s => s.tool === 'browser_navigate');
  // Fall back to the lifted login's navigate URL: with auth-as-fixture the app's
  // goto went into auth.setup.ts, so the business spec would otherwise start on
  // about:blank. (storageState restores the session but does NOT navigate.)
  const gotoTarget = startUrl ?? (authFile ? firstNavigateUrl(steps) : null);
  if (!hasNavigate && gotoTarget) {
    const gotoBlock: string[] = [];
    pushTestStep(gotoBlock, `Given · Open ${gotoTarget}`,
      [`await page.goto(${JSON.stringify(stripBaseUrl(gotoTarget))});`]);
    body.unshift(...gotoBlock);
  }

  // Then: Alt-click assertions group under the report's final stage.
  if (assertions.length > 0 && body.length > 0) body.push('');
  for (const a of assertions) {
    pushTestStep(body, `Then · ${a.hint ?? 'assertion'}`, [`await ${a.code};`]);
  }

  // ── Assemble: import + JSDoc header + signature (widened to { context } when
  //    a popup pairing needs it, and the page-object fixture when matched). ──
  const lines: string[] = [];
  lines.push(
    match
      ? `import { test, expect } from './fixtures';`
      : `import { test, expect } from '@playwright/test';`,
  );
  // Auth-as-fixture: reuse the session captured once by auth.setup.ts, so this
  // spec starts already logged in (the recorded login steps live in the setup
  // project, not inline here).
  if (authFile) {
    lines.push('');
    lines.push(`test.use({ storageState: ${JSON.stringify(authFile)} });`);
  }
  // Debt-2: shared reset helper + a beforeEach so every run starts from a clean
  // client state (the recipe was confirmed reproducible during recon).
  if (emitReset) {
    lines.push(`import { resetState } from './support/resetState';`);
    lines.push('');
    lines.push(`test.beforeEach(async ({ page, context }) => {`);
    lines.push(`  await resetState(page, context);`);
    lines.push(`});`);
  }
  lines.push('');
  lines.push('/**');
  lines.push(` * Generated by Hover on ${new Date().toISOString().slice(0, 10)}.`);
  if (userMsg?.text) lines.push(` * Original prompt: ${jsdocEscape(userMsg.text).slice(0, 240)}`);
  if (doneMsg?.summary) lines.push(` * Outcome: ${jsdocEscape(doneMsg.summary.split('\n')[0]).slice(0, 240)}`);
  if (proseSteps.length > 0) {
    lines.push(' *');
    lines.push(' * Steps:');
    proseSteps.forEach((s, i) => lines.push(` *   ${i + 1}. ${jsdocEscape(s)}`));
  }
  if (expectedLines.length > 0) {
    lines.push(' *');
    lines.push(' * Expected:');
    for (const e of expectedLines) {
      // Prefix EVERY line — a multi-line entry must not break out of the JSDoc
      // block (an unprefixed continuation line escapes the comment).
      const [head, ...rest] = jsdocEscape(e).split('\n');
      lines.push(` *   • ${head}`);
      for (const cont of rest) lines.push(` *     ${cont}`);
    }
  }
  if (omitted > 0) {
    lines.push(' *');
    lines.push(` * Note: ${omitted} exploratory/failed step${omitted === 1 ? '' : 's'} from the session`);
    lines.push(' * were omitted from this runnable flow (the full capture is kept in');
    lines.push(' * .hover/sidecars for the optimization pass).');
  }
  lines.push(' *');
  lines.push(' * Selectors prefer getByRole / getByLabel / getByTestId — generated from');
  lines.push(' * the agent\'s natural-language element descriptions, not raw CSS ids,');
  lines.push(' * so the spec survives markup changes that don\'t touch semantics.');
  lines.push(' */');
  const safeTitle = displayName.replace(/'/g, "\\'");
  const params = ['page'];
  if (usesContext) params.unshift('context');
  if (match) params.push(match.entry.fixtureName);
  lines.push(`test('${safeTitle}', async ({ ${params.join(', ')} }) => {`);
  if (body.length === 0) {
    lines.push('  // (no automatable steps were captured)');
  } else {
    for (const b of body) lines.push(b);
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/** Where the auth-fixture saves/reuses the authenticated session. */
const AUTH_STATE_FILE = 'playwright/.auth/user.json';

/**
 * Auth-as-fixture (debt 3): render the `auth.setup.ts` Playwright setup project
 * from the recorded login prefix. It replays the login ONCE and saves
 * `storageState`, which every spec then reuses via `test.use({ storageState })`
 * — so login isn't re-run per test. `authActions` are the leading (already
 * redacted) login steps; `startUrl` synthesizes a leading goto when the captured
 * login lacked its own navigation (agent connected to an open tab).
 */
function renderAuthSetup(authActions: SpecStep[], authFile: string, startUrl?: string): string {
  const body: string[] = [];
  if (!authActions.some(s => s.tool === 'browser_navigate') && startUrl) {
    body.push(`  await page.goto(${JSON.stringify(stripBaseUrl(startUrl))});`);
  }
  for (const s of authActions) {
    const lines = translateStep(s.tool!, s.input, 'page');
    if (lines.length === 0) continue;
    // Block-scope each step: every translated interaction declares its own
    // `const el`, so without a block the second step redeclares it (a JS error).
    body.push('  {');
    for (const line of lines) body.push(`    ${line}`);
    body.push('  }');
  }
  body.push(`  await context.storageState({ path: authFile });`);
  return [
    // `expect` is used by each step's visibility prelude — import it too.
    `import { test as setup, expect } from '@playwright/test';`,
    ``,
    `/**`,
    ` * Generated by Hover — authenticates ONCE, then specs reuse the saved`,
    ` * session via test.use({ storageState }). Login was lifted out of the specs`,
    ` * so it no longer re-runs per test.`,
    ` *`,
    ` * If you have your OWN playwright.config, register this setup project so it`,
    ` * runs before your specs:`,
    ` *`,
    ` *   projects: [`,
    ` *     { name: 'setup', testMatch: /.*\\.setup\\.ts$/ },`,
    ` *     { name: 'chromium', dependencies: ['setup'] },`,
    ` *   ]`,
    ` */`,
    `const authFile = ${JSON.stringify(authFile)};`,
    ``,
    `setup('authenticate', async ({ page, context }) => {`,
    ...body,
    `});`,
    ``,
  ].join('\n');
}

/** Push one `await test.step('<label>', async () => { … })` block (4-space
 *  body indent) onto the assembled spec lines. */
function pushTestStep(out: string[], label: string, inner: string[]): void {
  out.push(`  await test.step(${JSON.stringify(label)}, async () => {`);
  for (const l of inner) out.push(`    ${l}`);
  out.push(`  });`);
}

/** A click that may open a new tab — the opener half of an F6 popup pairing. */
function isPopupClick(s: SpecStep): boolean {
  return s.tool === 'browser_click' || s.tool === 'browser_double_click';
}

/** A browser_tabs step that selects a NEW tab (idx > 0) — the switch half of an
 *  F6 popup pairing. A select back to idx 0 is a return, not a popup open. */
function isTabSelectNew(s: SpecStep): boolean {
  const i = (s.input ?? {}) as Record<string, unknown>;
  return s.tool === 'browser_tabs'
    && i.action === 'select'
    && Number(i.idx ?? i.index ?? -1) > 0;
}

/** A tab switch back to the original tab (index/idx 0) → re-target to `page`. */
function isTabSelectOriginal(s: SpecStep): boolean {
  const i = (s.input ?? {}) as Record<string, unknown>;
  if (i.action !== 'select') return false;
  return Number(i.idx ?? i.index ?? -1) === 0;
}

/** A spec's leading steps matched against a known Page Object. */
interface PageObjectMatch {
  entry: PageObjectEntry;
  /** Method args (JSON-stringified values), in the order the method declares. */
  args: string[];
  /** Number of leading signature-bearing steps folded into the call. */
  consumedSigs: number;
}

/**
 * Stage 3c: find the longest Page Object whose recorded signature prefix
 * matches this spec's leading steps, so the spec can call it instead of
 * re-emitting those steps. Returns null when nothing matches.
 */
function matchPageObject(steps: SpecStep[], manifest: PageObjectManifest): PageObjectMatch | null {
  const sigSteps: { sig: string; step: SpecStep }[] = [];
  for (const s of steps) {
    if (s.kind !== 'step' || !s.tool) continue;
    const sig = stepSignature(s.tool, s.input);
    if (sig == null) continue;
    sigSteps.push({ sig, step: s });
  }
  const specSigs = sigSteps.map(x => x.sig);
  let best: PageObjectEntry | null = null;
  for (const p of manifest.pages) {
    if (p.signatures.length === 0 || p.signatures.length > specSigs.length) continue;
    if (p.signatures.every((sig, i) => sig === specSigs[i])) {
      if (!best || p.signatures.length > best.signatures.length) best = p;
    }
  }
  if (!best) return null;
  const consumed = sigSteps.slice(0, best.signatures.length).map(x => x.step);
  return { entry: best, args: flowArgValues(consumed), consumedSigs: best.signatures.length };
}

/**
 * The data values the Page Object method takes, in declaration order — the
 * fill / type / select values from the consumed prefix steps. Mirrors the
 * params generatePageObject lifts out, so the positions line up.
 */
function flowArgValues(steps: SpecStep[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const i = (s.input ?? {}) as Record<string, unknown>;
    switch (s.tool) {
      case 'browser_type':
        out.push(JSON.stringify(String(i.text ?? '')));
        break;
      case 'browser_select_option': {
        const values = i.values as unknown[] | undefined;
        const val = (values && values.length > 0 ? values[0] : i.value) ?? '';
        out.push(JSON.stringify(String(val)));
        break;
      }
      case 'browser_fill_form': {
        const fields = (i.fields as Array<Record<string, unknown>> | undefined) ?? [];
        for (const f of fields) out.push(JSON.stringify(String(f.value ?? '')));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function translateStep(rawTool: string, rawInput: unknown, pageVar = 'page'): string[] {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  // Non-playwright Hover MCP tools keep their mcp__<server>__ prefix; strip it
  // so the switch matches (playwright tools are already bare `browser_*`).
  // The server-name segment is kebab-case (`hover-control`, `hover-source`), so
  // the class MUST include `-`; a lazy quantifier stops at the first `__` so the
  // tool name (which may contain `_`) is preserved. Missing the hyphen here used
  // to drop every Hover-MCP step (e.g. check_control) to an optimizable marker.
  const tool = rawTool.replace(/^mcp__[a-z0-9_-]+?__/, '');
  switch (tool) {
    // Hover control-actuation tools → deterministic, grounded role/testid/text
    // selectors (the agent passed these from the snapshot, so they replay).
    case 'check_control': {
      const role = String(input.role ?? 'radio');
      const name = String(input.name ?? '');
      const action = input.checked === false ? 'uncheck' : 'check';
      // { force: true } mirrors what check_control did at record time — these
      // are sr-only inputs behind a styled label, so a normal .check() fails
      // the actionability hit-test ("<span> intercepts pointer events"). Force
      // skips it, the way a label click forwards to the hidden input.
      return [`await ${pageVar}.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)}, exact: true }).${action}({ force: true });`];
    }
    case 'click_control':
      return emitInteraction(groundedSelector(input, pageVar), 'click()');
    case 'fill_control':
      return emitInteraction(groundedSelector(input, pageVar), `fill(${renderFillValue(String(input.value ?? ''))})`);
    case 'select_control': {
      // A <select> is role 'combobox'; default it so a name-only step resolves.
      const withRole = input.role ? input : { ...input, role: input.name ? 'combobox' : undefined };
      return emitInteraction(groundedSelector(withRole, pageVar), `selectOption(${JSON.stringify(String(input.value ?? ''))})`);
    }
    case 'upload_file': {
      // setInputFiles directly on the file <input> (mirrors fileInput() in
      // mcp/actuateServer.ts) — no filechooser dialog. placeholder mode
      // references the committed fixture; otherwise the user-supplied path.
      const sel = fileInputSelector(input, pageVar);
      const rel = input.placeholder ? '__vibe_tests__/fixtures/hover-placeholder.png' : String(input.path ?? '');
      return [`await ${sel}.setInputFiles(${JSON.stringify(rel)});`];
    }
    case 'assert_visible': {
      // A captured verification → an expect(...). groundedSelector already
      // swaps a dynamic name/text for a stable anchor, so the locator is sound;
      // here we pick the MATCHER by volatility — a dynamic value never freezes
      // to a literal even if the agent passed matcher 'text-exact'.
      const sel = `${groundedSelector(input, pageVar)}.first()`;
      const dynamic = input.dynamic === true;
      const expected = input.expected != null ? String(input.expected)
        : input.observed != null ? String(input.observed) : '';
      switch (String(input.matcher ?? 'visible')) {
        case 'non-empty':
          return [`await expect(${sel}).not.toHaveText('');`];
        case 'text-contains':
          return [`await expect(${sel}).toContainText(${JSON.stringify(expected)});`];
        case 'text-exact':
          return dynamic
            ? [`await expect(${sel}).not.toHaveText('');`]
            : [`await expect(${sel}).toHaveText(${JSON.stringify(expected)});`];
        case 'count':
          return [`await expect(${groundedSelector(input, pageVar)}).toHaveCount(${Number(input.count ?? 1)});`];
        case 'visible':
        default:
          return [`await expect(${sel}).toBeVisible();`];
      }
    }
    case 'browser_navigate': {
      const url = String(input.url ?? '');
      const path = stripBaseUrl(url);
      return [`await ${pageVar}.goto(${JSON.stringify(path)});`];
    }
    case 'browser_click':
      return emitInteraction(selectorFromDescription(String(input.element ?? ''), pageVar), 'click()');
    case 'browser_double_click':
      return emitInteraction(selectorFromDescription(String(input.element ?? ''), pageVar), 'dblclick()');
    case 'browser_hover':
      return emitInteraction(selectorFromDescription(String(input.element ?? ''), pageVar), 'hover()');
    case 'browser_fill_form': {
      const fields = (input.fields as unknown[] | undefined) ?? [];
      return fields.flatMap(raw => {
        const f = raw as { name?: string; type?: string; value?: string; element?: string };
        const value = String(f.value ?? '');
        const target = f.name ?? f.element ?? '';
        // Each field gets its own block scope so the per-field `const el`
        // declarations don't collide inside the step's shared test.step closure.
        return blockScope(emitInteraction(
          selectorForFormField(target, f.type, pageVar),
          `fill(${renderFillValue(value)})`,
        ));
      });
    }
    case 'browser_type': {
      const text = String(input.text ?? '');
      const target = String(input.element ?? '');
      return emitInteraction(
        selectorFromDescription(target, pageVar),
        `fill(${renderFillValue(text)})`,
      );
    }
    case 'browser_select_option': {
      const target = String(input.element ?? '');
      const values = input.values as unknown[] | undefined;
      const val = (values && values.length > 0 ? values[0] : input.value) ?? '';
      return emitInteraction(
        selectorForSelect(target, pageVar),
        `selectOption(${JSON.stringify(String(val))})`,
      );
    }
    case 'browser_press_key': {
      const key = String(input.key ?? '');
      return [`await ${pageVar}.keyboard.press(${JSON.stringify(key)});`];
    }
    case 'browser_wait_for':
      // Skip "wait for" hints — Playwright auto-waits.
      return [];
    case 'browser_tabs':
    case 'browser_snapshot':
    case 'browser_take_screenshot':
    case 'browser_resize':
    case 'browser_evaluate':
    case 'browser_console_messages':
    case 'browser_network_requests':
      // Diagnostic / read-only / non-replayable on a fresh playwright run.
      return [];
    default:
      // A real action with no single-step translation. Leave a structured
      // marker (not a TODO) so the optimization pass / seed library can
      // complete it; the deterministic draft stays runnable around it.
      return [`${OPTIMIZABLE_MARKER}: ${tool} — no single-step translation; the optimization pass can complete this`];
  }
}

/**
 * Emit an interaction (click / dblclick / hover / fill / selectOption) as a
 * visibility-guarded prelude: hoist the locator to `el`, assert it's visible,
 * then act.
 *
 *    const el = page.getByRole('button', { name: 'Submit' });
 *    await expect(el).toBeVisible();
 *    await el.click();
 *
 * Why: `getByRole` is "visible OR attached" by default. A button that drifted
 * behind a closed `<details>` / kebab menu / drawer is still in the role tree,
 * so the locator stays green AND `.click()` may still fire — but the actual
 * user flow has degraded. Asserting visibility first makes that drift fail
 * loudly with "Locator expected to be visible" instead of silently passing.
 *
 * Scoping: renderSpec wraps each step in its own `test.step(… async () => {})`,
 * whose closure already scopes `el`, so a single interaction needs no extra
 * braces. browser_fill_form emits several fields into one step, so it wraps
 * each field in `blockScope(...)` to keep the per-field `el` from colliding.
 */
export function emitInteraction(selectorExpr: string, action: string): string[] {
  return [
    `const el = ${selectorExpr};`,
    `await expect(el).toBeVisible();`,
    `await el.${action};`,
  ];
}

/** Wrap lines in a `{ … }` block scope (2-space inner indent). Used by
 *  browser_fill_form so each field's `const el` lives in its own scope inside
 *  the shared test.step closure. */
export function blockScope(lines: string[]): string[] {
  return ['{', ...lines.map(l => `  ${l}`), '}'];
}

/**
 * Parse element descriptions like "Submit button" / "+1 button" / "Email
 * textbox" / "Plan radio" into `getByRole(role, { name })` selectors. The
 * trailing role keyword is the convention Playwright MCP uses.
 */
export function selectorFromDescription(desc: string, pageVar = 'page'): string {
  const trimmed = desc.trim();
  if (!trimmed) return `${pageVar}.locator('body')`;

  // Strip a leading "Link" / "Button" article-style prefix sometimes added
  // by the MCP, e.g. "Link \"Learn more\"". We only handle the trailing form.

  const roleMatch = trimmed.match(
    /^(.+?)\s+(button|link|textbox|checkbox|radio|combobox|switch|menuitem|tab|listitem|heading|dialog|cell|row|columnheader|rowheader|gridcell)$/i,
  );
  if (roleMatch) {
    const name = roleMatch[1].replace(/^"|"$/g, '');
    const role = roleMatch[2].toLowerCase();
    return `${pageVar}.getByRole('${role}', { name: ${JSON.stringify(name)} })`;
  }

  // Quoted label, e.g. \"Submit\" — fall back to getByText.
  const quoted = trimmed.match(/^"(.+)"$/);
  if (quoted) return `${pageVar}.getByText(${JSON.stringify(quoted[1])})`;

  return `${pageVar}.getByText(${JSON.stringify(trimmed)})`;
}

/**
 * Selector for a Hover control-actuation step (click/fill/select_control). The
 * agent supplied these fields straight from the snapshot, in the same priority
 * order the actuation server resolves them — role+name → testId → text — so the
 * crystallized selector is exactly the one that drove the action at record time
 * (no free-form description, hence no confabulation). Mirrors
 * `locate()` in `mcp/actuateServer.ts`.
 */
function groundedSelector(input: Record<string, unknown>, pageVar = 'page'): string {
  const role = typeof input.role === 'string' ? input.role : '';
  const name = typeof input.name === 'string' ? input.name : '';
  const testId = typeof input.testId === 'string' ? input.testId : '';
  const text = typeof input.text === 'string' ? input.text : '';
  // `within` scopes to a container first (e.g. getByRole('radiogroup', { name:
  // 'pep' })) so a repeated option label / a display:none input resolves to one
  // match inside the right group. Mirrors locate() in mcp/actuateServer.ts.
  const w = input.within as { role?: unknown; name?: unknown } | undefined;
  const base = w && typeof w.role === 'string' && typeof w.name === 'string'
    ? `${pageVar}.getByRole(${JSON.stringify(w.role)}, { name: ${JSON.stringify(w.name)}, exact: true })`
    : pageVar;
  // dynamic: the agent flagged `name`/`text` as content that varies run-to-run
  // (a drawn word, a generated id), so freezing it as an exact-name selector
  // would miss next run. Anchor on something stable instead: testId, then a
  // content-free role (scoped by `within` when present), then `.first()`.
  if (input.dynamic === true) {
    if (testId) return `${base}.getByTestId(${JSON.stringify(testId)})`;
    if (role) return `${base}.getByRole(${JSON.stringify(role)}).first()`;
    // No stable anchor available — fall through to the literal logic below; the
    // step is still recorded but brittle (a later anchor pass can harden it).
  }
  // exact: true — the agent passed the exact accessible name from the snapshot,
  // so match it exactly. Without it, getByRole's default substring match makes
  // "street" also resolve "previous street" → strict-mode violation on replay.
  if (role && name) return `${base}.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)}, exact: true })`;
  if (testId) return `${base}.getByTestId(${JSON.stringify(testId)})`;
  // .first(): a label-wrapped control's text matches the <label> AND its inner
  // <span> → strict-mode violation; the first (outer label) is clickable.
  if (text) return `${base}.getByText(${JSON.stringify(text)}).first()`;
  return `${base}.locator('body')`;
}

/** Selector for upload_file's target file <input> — by label, testId, or the
 *  single file input (optionally `within`-scoped). Mirrors fileInput() in
 *  mcp/actuateServer.ts. */
function fileInputSelector(input: Record<string, unknown>, pageVar = 'page'): string {
  const name = typeof input.name === 'string' ? input.name : '';
  const testId = typeof input.testId === 'string' ? input.testId : '';
  const w = input.within as { role?: unknown; name?: unknown } | undefined;
  const base = w && typeof w.role === 'string' && typeof w.name === 'string'
    ? `${pageVar}.getByRole(${JSON.stringify(w.role)}, { name: ${JSON.stringify(w.name)}, exact: true })`
    : pageVar;
  if (name) return `${base}.getByLabel(${JSON.stringify(name)})`;
  if (testId) return `${base}.getByTestId(${JSON.stringify(testId)})`;
  return `${base}.locator('input[type="file"]')`;
}

/**
 * browser_select_option always targets a native `<select>` — whose ARIA role
 * is `combobox`. The agent's description is usually the label ("marital
 * status"), with no role keyword, so selectorFromDescription would fall back to
 * getByText and match the *label text*, not the control — and `.selectOption()`
 * on a text node throws. Force the combobox role by accessible name instead.
 */
export function selectorForSelect(desc: string, pageVar = 'page'): string {
  const name = desc.trim()
    .replace(/\s+(combobox|select|dropdown|listbox)$/i, '') // drop a trailing role keyword
    .replace(/^"|"$/g, '');
  if (!name) return `${pageVar}.locator('select')`;
  return `${pageVar}.getByRole('combobox', { name: ${JSON.stringify(name)} })`;
}

/**
 * Form fields from browser_fill_form have a `name` that's typically the
 * accessible name / label / aria-label. getByLabel is the right primitive.
 * Fall back to getByRole('textbox') if we have a hint.
 */
export function selectorForFormField(name: string, type?: string, pageVar = 'page'): string {
  const trimmed = name.trim();
  if (!trimmed) return `${pageVar}.locator('input')`;
  if (type) {
    const role = mapInputType(type);
    if (role) return `${pageVar}.getByRole('${role}', { name: ${JSON.stringify(trimmed)} })`;
  }
  return `${pageVar}.getByLabel(${JSON.stringify(trimmed)})`;
}

function mapInputType(type: string): string | null {
  switch (type.toLowerCase()) {
    case 'textbox':
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
    case 'search':
    case 'password':
    case 'number':
      return 'textbox';
    case 'checkbox': return 'checkbox';
    case 'radio':    return 'radio';
    case 'combobox':
    case 'select':   return 'combobox';
    case 'slider':   return 'slider';
    case 'switch':   return 'switch';
    default: return null;
  }
}

/** Playwright config filenames Playwright itself recognizes. If any exists we
 *  assume the user owns baseURL config and never scaffold. */
const PLAYWRIGHT_CONFIG_NAMES = [
  'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs',
  'playwright.config.cjs', 'playwright.config.mts', 'playwright.config.cts',
];

/** Parse a URL's origin, or null if it isn't an absolute http(s) URL. */
function originOf(url?: string): string | null {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try { return new URL(url).origin; } catch { return null; }
}

/** Origin of the first real navigation captured in the session, e.g.
 *  http://localhost:5175 — the natural baseURL for the scaffolded config. */
function firstNavigateOrigin(steps: SpecStep[]): string | null {
  for (const s of steps) {
    if (s.kind !== 'step' || s.tool !== 'browser_navigate') continue;
    const url = String((s.input as Record<string, unknown> | undefined)?.url ?? '');
    if (/^https?:\/\//.test(url)) {
      try { return new URL(url).origin; } catch { /* not a parseable URL */ }
    }
  }
  return null;
}

/** The FULL url of the first browser_navigate in the session (not just origin).
 *  Used to seed the business spec's goto when auth-as-fixture lifted the login's
 *  navigation into auth.setup.ts and no explicit startUrl was supplied. */
function firstNavigateUrl(steps: SpecStep[]): string | null {
  for (const s of steps) {
    if (s.kind === 'step' && s.tool === 'browser_navigate') {
      const url = String((s.input as Record<string, unknown> | undefined)?.url ?? '');
      if (url) return url;
    }
  }
  return null;
}

/**
 * Bug A fix: crystallized specs use relative URLs, so a project with no
 * Playwright config (hence no baseURL) can't run them — `page.goto("/")` throws
 * "Cannot navigate to invalid URL". When no config exists, scaffold a minimal
 * one with baseURL inferred from the session's first navigation. Never touches
 * an existing config (the user owns it), and skips silently if no origin can be
 * inferred (leaves it to the user rather than guessing).
 */
/**
 * Debt-2 (reproducible state isolation): write the shared `support/resetState.ts`
 * helper that crystallized specs call in a beforeEach. It navigates to the app
 * (baseURL), clears client state, and reloads — so each run starts clean. The
 * goto-first ordering matters: localStorage is per-origin, so clearing it on the
 * initial about:blank would be a no-op. `keys` (the recipe's storageKeys) scopes
 * the localStorage clear when only some keys gate state (leaving e.g. an auth
 * token); empty = clear all web storage. Regenerated on every save so it tracks
 * the current recipe. User-facing Playwright code → lives under __vibe_tests__/.
 */
async function ensureResetStateHelper(devRoot: string, keys: string[]): Promise<void> {
  const dir = join(devRoot, '__vibe_tests__', 'support');
  await mkdir(dir, { recursive: true });
  const source = [
    `import type { Page, BrowserContext } from '@playwright/test';`,
    ``,
    `/**`,
    ` * Generated by Hover — resets the app to a clean client-side state before`,
    ` * each test, so runs are reproducible. The reset recipe was discovered (and`,
    ` * verified) during exploration and lives in .hover/environments.json;`,
    ` * re-crystallize to regenerate this file.`,
    ` */`,
    `const KEYS: string[] = ${JSON.stringify(keys)};`,
    ``,
    `export async function resetState(page: Page, context: BrowserContext): Promise<void> {`,
    `  // goto first: localStorage is per-origin, so it can only be cleared once`,
    `  // the app's origin is loaded (baseURL comes from the Playwright config).`,
    `  await page.goto('/');`,
    `  await context.clearCookies();`,
    `  await page.evaluate((keys) => {`,
    `    if (keys.length) { for (const k of keys) localStorage.removeItem(k); }`,
    `    else { localStorage.clear(); sessionStorage.clear(); }`,
    `  }, KEYS);`,
    `  await page.reload();`,
    `}`,
    ``,
  ].join('\n');
  await writeFile(join(dir, 'resetState.ts'), source, 'utf-8');
}

async function ensurePlaywrightConfig(devRoot: string, steps: SpecStep[], startUrl?: string, authFile?: string): Promise<void> {
  if (PLAYWRIGHT_CONFIG_NAMES.some(n => existsSync(join(devRoot, n)))) return;
  const origin = firstNavigateOrigin(steps) ?? originOf(startUrl);
  if (!origin) return;
  // Auth-as-fixture: register a `setup` project (matches auth.setup.ts) that the
  // main project depends on, so login runs ONCE before the specs. Only emitted
  // when scaffolding our own config (we never touch a user's existing one).
  const projects = authFile
    ? [
        `  projects: [`,
        `    { name: 'setup', testMatch: /.*\\.setup\\.ts$/ },`,
        `    { name: 'chromium', dependencies: ['setup'] },`,
        `  ],`,
      ]
    : [];
  const source = [
    `import { defineConfig } from '@playwright/test';`,
    ``,
    `/**`,
    ` * Scaffolded by Hover so crystallized specs (which use relative URLs like`,
    ` * page.goto("/")) resolve against a base. Override HOVER_BASE_URL in CI to`,
    ` * point the same specs at staging/prod.`,
    ` */`,
    `export default defineConfig({`,
    `  testDir: './__vibe_tests__',`,
    `  use: {`,
    `    baseURL: process.env.HOVER_BASE_URL ?? ${JSON.stringify(origin)},`,
    `  },`,
    ...projects,
    `});`,
    ``,
  ].join('\n');
  await writeFile(join(devRoot, 'playwright.config.ts'), source, 'utf-8');
}

function stripBaseUrl(url: string): string {
  // http://localhost:5173/checkout → /checkout, http://localhost:5173/ → /
  if (!/^https?:\/\//.test(url)) return url;
  const u = new URL(url);
  return u.pathname + u.search + u.hash || '/';
}
