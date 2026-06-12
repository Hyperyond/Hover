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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillStep } from '../skills/writeSkill.js';
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

export interface WriteSpecOptions {
  devRoot: string;
  name: string;
  description?: string;
  steps: SpecStep[];
  assertions?: SpecAssertion[];
  overwrite?: boolean;
}

export interface WriteSpecResult { path: string; slug: string; }

export async function writeSpec(opts: WriteSpecOptions): Promise<WriteSpecResult> {
  const slug = slugify(opts.name);
  if (!slug) throw new Error('spec name must contain at least one alphanumeric character');
  if (!opts.steps.some(s => s.kind === 'step')) {
    throw new Error('spec must contain at least one tool step to replay');
  }

  const dir = join(opts.devRoot, '__vibe_tests__');
  const path = join(dir, `${slug}.spec.ts`);

  if (!opts.overwrite && existsSync(path)) {
    throw new SpecExistsError(slug, path);
  }

  await mkdir(dir, { recursive: true });
  // Stage 3c: if a prior extraction left a Page Object whose flow prefixes
  // this spec, consume it (await loginPage.login(…)) instead of re-emitting
  // the steps inline. No manifest (extraction never ran) → plain spec.
  const manifest = await readPageObjectManifest(opts.devRoot);
  const match = manifest ? matchPageObject(opts.steps, manifest) : null;
  const source = renderSpec(slug, opts.name, opts.description ?? '', opts.steps, opts.assertions ?? [], match);
  await writeFile(path, source, 'utf-8');
  // Persist the structured session next to the spec so cross-session
  // extraction (F4) and the optimization pass (F7) read real SpecStep[]
  // instead of parsing the generated code. Lands in .hover/, which
  // Playwright's *.spec.ts glob never collects.
  await writeSidecar(opts.devRoot, {
    slug,
    name: opts.name,
    steps: opts.steps,
    assertions: opts.assertions ?? [],
  });
  // Session-ledger patch, best-effort by contract: markSessionSaved swallows
  // its own failures — it must never break Save-as-spec.
  const promptText = opts.steps.find(s => s.kind === 'user')?.text;
  if (promptText) await markSessionSaved(opts.devRoot, promptText, slug);
  return { path, slug };
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
): string {
  const userMsg = steps.find(s => s.kind === 'user');
  const doneMsg = [...steps].reverse().find(s => s.kind === 'done');

  // Plain-English step + expected blocks for the JSDoc header. QA / PMs
  // can read these without grokking Playwright API; the same prose also
  // populates the Step column when the user exports the session to Xray
  // CSV via writeCaseCsv.
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

  const actions = steps.filter(s => s.kind === 'step' && !!s.tool);
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
    for (const e of expectedLines) lines.push(` *   • ${jsdocEscape(e)}`);
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

function translateStep(tool: string, rawInput: unknown, pageVar = 'page'): string[] {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  switch (tool) {
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
          `fill(${JSON.stringify(value)})`,
        ));
      });
    }
    case 'browser_type': {
      const text = String(input.text ?? '');
      const target = String(input.element ?? '');
      return emitInteraction(
        selectorFromDescription(target, pageVar),
        `fill(${JSON.stringify(text)})`,
      );
    }
    case 'browser_select_option': {
      const target = String(input.element ?? '');
      const values = input.values as unknown[] | undefined;
      const val = (values && values.length > 0 ? values[0] : input.value) ?? '';
      return emitInteraction(
        selectorFromDescription(target, pageVar),
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
      return [`${OPTIMIZABLE_MARKER}: ${tool} — no single-step translation; the optimization pass or a .hover/rules/ seed can complete this`];
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

function stripBaseUrl(url: string): string {
  // http://localhost:5173/checkout → /checkout, http://localhost:5173/ → /
  if (!/^https?:\/\//.test(url)) return url;
  const u = new URL(url);
  return u.pathname + u.search + u.hash || '/';
}
