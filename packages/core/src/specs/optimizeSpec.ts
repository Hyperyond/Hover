/**
 * Stage 7 (F7): the optional LLM optimization pass.
 *
 * Reads a deterministic draft spec + its sidecar, asks an LLM (the codegen
 * mode — no browser, no MCP) to improve it (chiefly: add assertions for the
 * feedback the session observed), validates the result, and writes it as a
 * CANDIDATE at `.hover/cache/optimized/<slug>.spec.ts.draft` — never overwriting the
 * original (D10). A human promotes or discards it via diff.
 *
 * The LLM call is injected (`runCodegen`) so callers wire their own agent and
 * tests run deterministically without spawning anything.
 */
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { readSidecar, type SpecSidecar } from './sidecar.js';
import { BUILTIN_SEEDS, relevantSeeds, type SeedRule } from './seeds.js';
import { softBatch } from './softBatch.js';

export class OptimizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimizeError';
  }
}

/** Runs the codegen LLM on a prompt and returns its raw text output. */
export type RunCodegen = (prompt: string) => Promise<string>;

/** Project context fed to the refinement pass so the candidate FITS the existing
 *  suite: the team's conventions + the reusable Page Objects to prefer over raw
 *  locators. Relevant files only (POMs + conventions), NOT the whole suite — the
 *  refinement is a cheap pass, keep the context bounded. */
export interface SuiteContext {
  conventions?: string;
  pages: { name: string; source: string }[];
}

/** Total Page-Object source budget injected into the prompt (chars). Keeps the
 *  refinement context bounded on a large suite; extra POMs are dropped (logged in
 *  the prompt) rather than blowing the window. */
const POM_CONTEXT_BUDGET = 16_000;

/** Best-effort gather of the suite context (conventions.md + __vibe_tests__/pages
 *  Page Objects). Missing files → empty; never throws. */
export async function gatherSuiteContext(devRoot: string): Promise<SuiteContext> {
  const conventions = (await readFile(join(devRoot, '.hover', 'conventions.md'), 'utf-8').catch(() => ''))
    .trim() || undefined;
  const pages: { name: string; source: string }[] = [];
  let used = 0;
  try {
    const dir = join(devRoot, '__vibe_tests__', 'pages');
    for (const f of (await readdir(dir)).sort()) {
      if (!f.endsWith('.ts')) continue;
      const source = (await readFile(join(dir, f), 'utf-8').catch(() => '')).trim();
      if (!source || used + source.length > POM_CONTEXT_BUDGET) continue;
      used += source.length;
      pages.push({ name: f, source });
    }
  } catch { /* no pages dir — plain spec, no POMs to reuse */ }
  return { conventions, pages };
}

export interface OptimizeResult {
  /** Absolute path of the written candidate (never the original spec). */
  candidatePath: string;
  /** The validated candidate source. */
  code: string;
  /** The original (deterministic) spec the candidate was generated from —
   *  returned so callers can show a diff without re-reading the file. */
  original: string;
}

export async function optimizeSpec(
  devRoot: string,
  slug: string,
  runCodegen: RunCodegen,
): Promise<OptimizeResult> {
  const { prompt, original } = await buildOptimizeBrief(devRoot, slug);
  const raw = await runCodegen(prompt);
  const { candidatePath, code } = await saveOptimizedCandidate(devRoot, slug, extractCode(raw));
  return { candidatePath, code, original };
}

/**
 * MCP-first optimize (F7) without a Hover-owned model: build the improvement
 * brief for a spec, hand it to the USER's own agent (which IS the intelligence),
 * and let it write the improved file back through `saveOptimizedCandidate`.
 *
 * Returns the prompt the agent works from (the same improvement rules the
 * legacy in-engine `optimizeSpec` used) + the original spec, so a caller can
 * diff. Throws OptimizeError if the spec doesn't exist. No LLM runs here.
 */
export async function buildOptimizeBrief(
  devRoot: string,
  slug: string,
): Promise<{ prompt: string; original: string }> {
  const specPath = join(devRoot, '__vibe_tests__', `${slug}.spec.ts`);
  let draft: string;
  try {
    draft = await readFile(specPath, 'utf-8');
  } catch {
    throw new OptimizeError(`spec not found: ${slug} (looked at ${specPath})`);
  }

  // Legacy-aware read; null → no sidecar, optimize from the draft alone.
  const sidecar: SpecSidecar | null = await readSidecar(devRoot, slug);
  const specTools = new Set(
    (sidecar?.steps ?? [])
      .filter(s => s.kind === 'step' && s.tool)
      .map(s => s.tool as string),
  );
  const seeds = relevantSeeds(BUILTIN_SEEDS, specTools);
  const suite = await gatherSuiteContext(devRoot);

  // The agent path ends by CALLING a tool (not by emitting raw text), so swap
  // the legacy "output ONLY the file" footer for a save_optimized_spec directive.
  const outputInstruction =
    `When done, call \`save_optimized_spec\` with slug "${slug}" and the COMPLETE improved ` +
    `.ts file as \`code\`. Hover validates it (semantic selectors, no waitForTimeout/XPath), ` +
    `soft-batches trailing assertions, and files it as a REVIEW CANDIDATE at ` +
    `.hover/cache/optimized/${slug}.spec.ts.draft — it does NOT touch your spec. If it comes ` +
    `back with a ✗ (a rejected check), fix that and call it again. Then tell the user the ` +
    `candidate path so they can diff it against __vibe_tests__/${slug}.spec.ts and promote it.`;

  return { prompt: buildOptimizePrompt(draft, sidecar, seeds, suite, outputInstruction), original: draft };
}

/**
 * Deterministic finishing + write for an optimized spec the agent produced:
 * validate the LLM's code against the same guardrails the deterministic path
 * keeps, soft-batch the trailing independent assertions, and write it as a
 * CANDIDATE (`.hover/cache/optimized/<slug>.spec.ts.draft`) — never the original.
 * Throws OptimizeError if the code fails validation (the caller surfaces it so
 * the agent can retry). No LLM runs here.
 */
export async function saveOptimizedCandidate(
  devRoot: string,
  slug: string,
  llmCode: string,
): Promise<{ candidatePath: string; code: string }> {
  const check = validateSpecCode(llmCode);
  if (!check.ok) {
    throw new OptimizeError(`optimization rejected — ${check.errors.join('; ')}`);
  }
  // Soft-batch applies the safe mechanical rewrite (a trailing run of
  // independent assertions → expect.soft) surgically. See softBatch.ts.
  const code = softBatch(llmCode).code;

  // Candidates are disposable derived artifacts → `.hover/cache/` (always
  // gitignored). Losing one costs a re-run of the optimization, nothing more.
  const dir = join(devRoot, '.hover', 'cache', 'optimized');
  await mkdir(dir, { recursive: true });
  // `.spec.ts.draft`, never `*.spec.ts` — Playwright's glob must not collect a
  // candidate before a human reviews it.
  const candidatePath = join(dir, `${slug}.spec.ts.draft`);
  await writeFile(candidatePath, code.endsWith('\n') ? code : `${code}\n`, 'utf-8');
  return { candidatePath, code };
}

/**
 * Build the codegen prompt: the current spec + the observed session, plus the
 * same rules the deterministic path enforces (semantic selectors, no XPath, no
 * waitForTimeout, keep the test.step shape).
 */
export function buildOptimizePrompt(
  draft: string,
  sidecar: SpecSidecar | null,
  seeds: SeedRule[] = [],
  suite: SuiteContext = { pages: [] },
  outputInstruction = 'Output ONLY the complete .ts file contents — no markdown fences, no prose, no explanation.',
): string {
  const done = sidecar?.steps.find(s => s.kind === 'done');
  const stepsJson = sidecar
    ? JSON.stringify(sidecar.steps.filter(s => s.kind === 'step'), null, 2)
    : '(no sidecar captured)';
  return [
    `You are improving an already-correct, generated Playwright spec. You are`,
    `given the current deterministic spec and the structured browser session it`,
    `was crystallized from.`,
    ``,
    `Improve it WITHOUT changing what it tests:`,
    `  - Add assertions for the success/error feedback the session OBSERVED —`,
    `    e.g. await expect(page.getByText('Invalid email')).toBeVisible(), a`,
    `    success toast, a confirmation. Use the captured steps + the outcome`,
    `    summary below to know what to assert.`,
    `  - ASSERT THE INVARIANT, NOT THIS RUN'S VALUE. When the asserted content`,
    `    varies run-to-run (a generated id, an order number, a date, a counter, a`,
    `    drawn word — and ANY step whose captured input has "dynamic": true),`,
    `    assert the contract with a pattern, never the literal: expect(loc).not`,
    `    .toHaveText('') or .toContainText(/…/), or .toHaveCount(n). Reserve an`,
    `    exact-literal assertion for genuinely fixed text (a heading, a fixed`,
    `    confirmation). Any captured assert_visible step already encodes this —`,
    `    preserve its matcher/intent; don't tighten a dynamic one back to a literal.`,
    `  - DE-LITERALIZE VOLATILE VALUES — even ones NOT pre-flagged. Scan every`,
    `    selector and assertion in the spec for values that are this run's DATA, not`,
    `    stable UI: a word/title/name/id/order number/date/price/count drawn from`,
    `    app content. Judge from what this app IS (the conventions + Page Objects`,
    `    below tell you) and the captured values. For each volatile one:`,
    `    getByRole(role, { name: "<value>" }) -> a stable anchor (getByTestId, or`,
    `    getByRole(role).first(), or a Page Object method); toHaveText("<value>") ->`,
    `    .not.toHaveText('') or .toContainText(/.../). When unsure if a value is`,
    `    volatile, PREFER the invariant — over-asserting a changing value is the`,
    `    failure we are fixing. But NEVER newly hard-code a value that wasn't there.`,
    `  - REUSE the project's Page Objects + conventions (below). If a step sequence`,
    `    matches a Page Object method, CALL it instead of re-emitting raw locators,`,
    `    and follow the naming / structure the existing suite uses.`,
    `  - Keep semantic selectors: getByRole / getByLabel / getByText. NEVER emit`,
    `    XPath or CSS-id selectors. NEVER use waitForTimeout (Playwright`,
    `    auto-waits).`,
    `  - Keep the existing import line and the test.step(...) structure.`,
    `  - Do not invent steps the session did not perform.`,
    `  - If an observed outcome looks like a BUG (it contradicts what a correct`,
    `    app should do — a stale error that never clears, the wrong message, a`,
    `    value that should have changed but didn't), STILL assert the observed`,
    `    reality (Hover records what actually happened), but put a comment`,
    `    "// KNOWN BUG: <one line>" on the line directly above that assertion so a`,
    `    human can find it and so the test breaks loudly once the app is fixed.`,
    `    Never silently lock buggy behavior into a normal-looking assertion.`,
    ``,
    outputInstruction,
    ``,
    `=== CURRENT SPEC ===`,
    draft,
    ``,
    `=== OBSERVED OUTCOME ===`,
    done?.summary?.trim() || '(none)',
    ``,
    `=== CAPTURED STEPS ===`,
    stepsJson,
    ...(suite.conventions
      ? [``, `=== PROJECT CONVENTIONS (follow these) ===`, suite.conventions]
      : []),
    ...(suite.pages.length > 0
      ? [
          ``,
          `=== REUSABLE PAGE OBJECTS (prefer calling these over raw locators) ===`,
          ...suite.pages.map(p => `// ${p.name}\n${p.source}`),
        ]
      : []),
    ...(seeds.length > 0
      ? [
          ``,
          `=== WORKED EXAMPLES (apply a pattern ONLY if the steps genuinely match it) ===`,
          ...seeds.map(s =>
            `# ${s.name}${s.note ? ` — ${s.note}` : ''}\n` +
            `WHEN steps look like: ${JSON.stringify(s.example.steps)}\n` +
            `EMIT something like:\n${s.example.code}`,
          ),
        ]
      : []),
  ].join('\n');
}

/** Strip a ```ts fence if the model wrapped its output in one. */
export function extractCode(raw: string): string {
  const t = raw.trim();
  const fence = t.match(/```(?:ts|typescript|tsx|javascript|js)?\s*\n([\s\S]*?)```/);
  return (fence ? fence[1] : t).trim();
}

/**
 * Code-level guardrails — the same constraints the deterministic path keeps,
 * enforced on the LLM's output so an optimization can't drift off-policy. This
 * is what lets us allow an LLM to author here without a markdown constitution.
 */
export function validateSpecCode(code: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!code.trim()) errors.push('empty output');
  if (/\bwaitForTimeout\b/.test(code)) errors.push('uses waitForTimeout');
  if (/xpath\s*=|locator\(\s*['"`]\/\//i.test(code)) errors.push('uses an XPath selector');
  if (!/\btest\s*\(/.test(code)) errors.push('no test() block');
  if (!/from\s+['"](@playwright\/test|\.\/fixtures)['"]/.test(code)) {
    errors.push('missing @playwright/test (or ./fixtures) import');
  }
  if (hasSyntaxError(code)) errors.push('has a syntax error');
  return { ok: errors.length === 0, errors };
}

/**
 * Real syntax check via the TypeScript parser (the same ts-morph the soft-batch
 * step uses). Replaces a naive `{`/`}` count that mis-flagged a valid spec
 * asserting on a string like 'a { b' — braces inside string literals are not
 * structural. We look at SYNTACTIC diagnostics only: a candidate references
 * `page` / `expect` / `@playwright/test` that aren't resolvable in this throwaway
 * project, so SEMANTIC ("cannot find module", "implicitly any") diagnostics are
 * expected and must be ignored — only a genuine parse error (an unbalanced
 * brace, a stray token) should reject the optimization.
 */
function hasSyntaxError(code: string): boolean {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  });
  const sf = project.createSourceFile('__candidate.ts', code, { overwrite: true });
  return project.getProgram().getSyntacticDiagnostics(sf).length > 0;
}

