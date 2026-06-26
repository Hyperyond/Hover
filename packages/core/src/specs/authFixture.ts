/**
 * Auth-as-fixture (crystallization debt 3) — login-prefix detection.
 *
 * Today a recorded login is crystallized INLINE into every spec and re-run
 * through the UI each test. The fix is to lift the login into a Playwright setup
 * project that authenticates ONCE, save `storageState`, and have specs start
 * already authenticated. The first, pure step is detecting which leading steps
 * ARE the login flow — done here so it can be unit-tested in isolation, with no
 * codegen changes (those land in later stages).
 *
 * Signal: `redactSteps` (writeSpec.ts) already rewrites credential values to
 * `process.env.<envVar> ?? ''`, so the credential-bearing steps are exactly the
 * fills whose value references one of the run's redaction env vars. The login
 * prefix is the run of steps up to AND INCLUDING the submit click that follows
 * the last credential fill.
 *
 * See docs/superpowers/specs/2026-06-24-auth-as-fixture.md.
 */
import { Project, SyntaxKind, Node, type SourceFile, type ObjectLiteralExpression } from 'ts-morph';
import type { SkillStep } from './specStep.js';

const CLICK_TOOLS = new Set(['browser_click', 'click_control']);

/** Bare tool name — grounded steps arrive as `mcp__hover-control__click_control`,
 *  playwright ones as bare `browser_click`. */
const bareTool = (t?: string): string => (t ?? '').replace(/^mcp__[a-z0-9_-]+?__/, '');

/** The string values a fill-type action writes, across the tool variants
 *  (browser_type / fill_control / select_control / browser_fill_form). */
function fillValues(step: SkillStep): string[] {
  if (step.kind !== 'step' || !step.input) return [];
  const input = step.input as Record<string, unknown>;
  const out: string[] = [];
  if (typeof input.text === 'string') out.push(input.text); // browser_type
  if (typeof input.value === 'string') out.push(input.value); // fill_control / select_control
  if (Array.isArray(input.fields)) {
    // browser_fill_form
    for (const f of input.fields as Array<Record<string, unknown>>) {
      if (f && typeof f.value === 'string') out.push(f.value);
    }
  }
  return out;
}

/** True when an action fills one of the redacted credential env refs. `actions`
 *  are POST-redaction, so a credential value reads `process.env.<envVar> ?? ''`. */
function fillsCredential(step: SkillStep, envVars: readonly string[]): boolean {
  if (!envVars.length) return false;
  const values = fillValues(step);
  return values.some((v) => envVars.some((name) => v.includes(`process.env.${name}`)));
}

/**
 * Length of the leading login prefix among `actions` (a spec's tool steps,
 * POST-redaction). The login flow = the steps up to AND INCLUDING the submit
 * click that follows the LAST credential fill (e.g. navigate → type email →
 * type password → click "Sign in"). `envVars` are the redaction env-var names.
 *
 * Returns 0 when there are no redacted credentials, or none are filled in the
 * steps — so a spec with no login keeps today's inline behavior unchanged (no
 * regression). The caller slices `actions[0..N)` as the auth prefix and
 * `actions[N..]` as the business flow.
 */
export function authPrefixLength(actions: SkillStep[], envVars: readonly string[]): number {
  if (!envVars.length) return 0;
  let lastCred = -1;
  for (let i = 0; i < actions.length; i++) {
    if (fillsCredential(actions[i], envVars)) lastCred = i;
  }
  if (lastCred < 0) return 0;
  // Extend through the submit click immediately after the last credential fill
  // (the "Sign in" button). A non-click next step means login auto-submitted (or
  // we've already moved into the app), so stop at the fill — don't over-capture.
  const next = actions[lastCred + 1];
  if (next && CLICK_TOOLS.has(bareTool(next.tool))) return lastCred + 2;
  return lastCred + 1;
}

/**
 * Locate the Playwright config object literal — the argument of `defineConfig({…})`
 * or a bare `export default {…}` — so the setup project can be inserted into it.
 */
function findConfigObject(sf: SourceFile): ObjectLiteralExpression | undefined {
  const def = sf.getExportAssignment((d) => !d.isExportEquals());
  const expr = def?.getExpression();
  if (expr) {
    if (Node.isObjectLiteralExpression(expr)) return expr;
    if (Node.isCallExpression(expr)) {
      const arg = expr.getArguments()[0];
      if (arg && Node.isObjectLiteralExpression(arg)) return arg;
    }
  }
  // Fallback: a defineConfig(...) call anywhere in the file.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === 'defineConfig') {
      const arg = call.getArguments()[0];
      if (arg && Node.isObjectLiteralExpression(arg)) return arg;
    }
  }
  return undefined;
}

/**
 * Stage 4a — propose the playwright.config edit that registers the auth-fixture
 * setup project. AST-based (ts-morph) so it only reprints what it touches and
 * preserves the user's formatting. Adds:
 *
 *   projects: [
 *     { name: 'setup', testMatch: /.*\.setup\.ts$/ },
 *     { name: 'chromium', dependencies: ['setup'] },
 *   ]
 *
 * Returns the edited source, or null when it can't safely edit — no config
 * object found, or `projects` ALREADY exists (merging into a user's project
 * matrix is risky; the caller degrades to the static paste hint instead). The
 * edit is never applied here; the caller shows it for approval first.
 */
export function addSetupProjectToConfig(source: string): string | null {
  try {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
    const sf = project.createSourceFile('__pwconfig.ts', source, { overwrite: true });
    const obj = findConfigObject(sf);
    if (!obj) return null;
    if (obj.getProperty('projects')) return null; // user already manages projects — don't risk it
    obj.addPropertyAssignment({
      name: 'projects',
      initializer: [
        '[',
        "    { name: 'setup', testMatch: /.*\\.setup\\.ts$/ },",
        "    { name: 'chromium', dependencies: ['setup'] },",
        '  ]',
      ].join('\n'),
    });
    return sf.getFullText();
  } catch {
    return null;
  }
}
