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

export type SpecStep = SkillStep;

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
  const source = renderSpec(slug, opts.name, opts.description ?? '', opts.steps, opts.assertions ?? []);
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
  return { path, slug };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
    const first = doneSummary.split(/(?<=[.!?])\s+/)[0] ?? doneSummary;
    return [first.trim()];
  }
  return [];
}

function renderSpec(
  slug: string,
  displayName: string,
  description: string,
  steps: SpecStep[],
  assertions: SpecAssertion[],
): string {
  const userMsg = steps.find(s => s.kind === 'user');
  const doneMsg = [...steps].reverse().find(s => s.kind === 'done');

  // Plain-English step + expected blocks for the JSDoc header. QA / PMs
  // can read these without grokking Playwright API; the same prose also
  // populates the Step column when the user exports the session to Xray
  // CSV via writeCaseCsv.
  const proseSteps = humanSteps(steps);
  const expectedLines = collectExpected(assertions, doneMsg?.summary);

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
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
  lines.push(`test('${safeTitle}', async ({ page }) => {`);

  // Each captured step becomes one `test.step(...)` so Playwright's HTML
  // report reads as named Given/When/Then stages instead of a flat body. The
  // label reuses the same human-readable prose as the JSDoc Steps block
  // (humanStep), prefixed by a phase inferred from position: navigation
  // before the first real interaction = Given, interactions = When,
  // assertions = Then. `expect` is imported unconditionally — the visibility
  // preludes inside each step depend on it.
  let hasAwait = false;
  let sawInteraction = false;
  for (const s of steps) {
    if (s.kind !== 'step' || !s.tool) continue;
    const body = translateStep(s.tool, s.input);
    if (body.length === 0) continue; // diagnostic / non-replayable — skipped
    const phase = !sawInteraction && s.tool === 'browser_navigate' ? 'Given' : 'When';
    const label = `${phase} · ${humanStep(s.tool, s.input) ?? s.tool}`;
    lines.push(`  await test.step(${JSON.stringify(label)}, async () => {`);
    for (const c of body) lines.push(`    ${c}`);
    lines.push(`  });`);
    hasAwait = true;
    if (s.tool !== 'browser_navigate') sawInteraction = true;
  }

  if (assertions.length > 0) {
    if (hasAwait) lines.push('');
    // Alt-click assertions become Then steps so they group under the report's
    // final stage alongside the When interactions above.
    for (const a of assertions) {
      const label = `Then · ${a.hint ?? 'assertion'}`;
      lines.push(`  await test.step(${JSON.stringify(label)}, async () => {`);
      lines.push(`    await ${a.code};`);
      lines.push(`  });`);
    }
  }

  if (!hasAwait && assertions.length === 0) {
    lines.push('  // (no automatable steps were captured)');
  }

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

function translateStep(tool: string, rawInput: unknown): string[] {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'browser_navigate': {
      const url = String(input.url ?? '');
      const path = stripBaseUrl(url);
      return [`await page.goto(${JSON.stringify(path)});`];
    }
    case 'browser_click':
      return emitInteraction(selectorFromDescription(String(input.element ?? '')), 'click()');
    case 'browser_double_click':
      return emitInteraction(selectorFromDescription(String(input.element ?? '')), 'dblclick()');
    case 'browser_hover':
      return emitInteraction(selectorFromDescription(String(input.element ?? '')), 'hover()');
    case 'browser_fill_form': {
      const fields = (input.fields as unknown[] | undefined) ?? [];
      return fields.flatMap(raw => {
        const f = raw as { name?: string; type?: string; value?: string; element?: string };
        const value = String(f.value ?? '');
        const target = f.name ?? f.element ?? '';
        // Each field gets its own block scope so the per-field `const el`
        // declarations don't collide inside the step's shared test.step closure.
        return blockScope(emitInteraction(
          selectorForFormField(target, f.type),
          `fill(${JSON.stringify(value)})`,
        ));
      });
    }
    case 'browser_type': {
      const text = String(input.text ?? '');
      const target = String(input.element ?? '');
      return emitInteraction(
        selectorFromDescription(target),
        `fill(${JSON.stringify(text)})`,
      );
    }
    case 'browser_select_option': {
      const target = String(input.element ?? '');
      const values = input.values as unknown[] | undefined;
      const val = (values && values.length > 0 ? values[0] : input.value) ?? '';
      return emitInteraction(
        selectorFromDescription(target),
        `selectOption(${JSON.stringify(String(val))})`,
      );
    }
    case 'browser_press_key': {
      const key = String(input.key ?? '');
      return [`await page.keyboard.press(${JSON.stringify(key)});`];
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
      return [`// TODO: translate ${tool} (skipped — unknown tool for spec emission)`];
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
