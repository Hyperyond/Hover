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
import { readFile, mkdir, writeFile } from 'node:fs/promises';
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
  const raw = await runCodegen(buildOptimizePrompt(draft, sidecar, seeds));
  const llmCode = extractCode(raw);
  const check = validateSpecCode(llmCode);
  if (!check.ok) {
    throw new OptimizeError(`optimization rejected — ${check.errors.join('; ')}`);
  }

  // Deterministic finishing step: the LLM decided WHAT to assert; soft-batch
  // applies the safe mechanical rewrite (trailing run of independent assertions
  // → expect.soft) surgically on its output. See softBatch.ts for the guard.
  const code = softBatch(llmCode).code;

  // Candidates are disposable derived artifacts → `.hover/cache/` (always
  // gitignored). Losing one costs a re-run of the optimization, nothing more.
  const dir = join(devRoot, '.hover', 'cache', 'optimized');
  await mkdir(dir, { recursive: true });
  // `.spec.ts.draft`, never `*.spec.ts` — Playwright's glob must not collect a
  // candidate before a human reviews it.
  const candidatePath = join(dir, `${slug}.spec.ts.draft`);
  await writeFile(candidatePath, code.endsWith('\n') ? code : `${code}\n`, 'utf-8');
  return { candidatePath, code, original: draft };
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
    `Output ONLY the complete .ts file contents — no markdown fences, no prose,`,
    `no explanation.`,
    ``,
    `=== CURRENT SPEC ===`,
    draft,
    ``,
    `=== OBSERVED OUTCOME ===`,
    done?.summary?.trim() || '(none)',
    ``,
    `=== CAPTURED STEPS ===`,
    stepsJson,
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

