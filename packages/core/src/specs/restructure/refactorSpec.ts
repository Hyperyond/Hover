/**
 * Architecture pass orchestrator — `hover refactor`.
 *
 * Runs the deterministic structural passes over a saved spec and, if anything
 * changed, writes the result as a CANDIDATE at
 * `.hover/restructured/<slug>.spec.ts.draft` — never overwriting the original
 * (same D10 contract as the optimize pass). A human promotes or discards it via
 * the diff.
 *
 * Unlike the optimize pass this is fully deterministic and zero-token: no LLM,
 * no agent, no network. Each pass is an AST transform that is provably
 * semantics-preserving (see softBatch's trailing-run guard). That is why these
 * passes ship complete and maintainer-owned (Prettier-style), rather than as a
 * community plugin surface: a bad structural transform could produce a
 * false-green test, which the seed library's blast radius never reaches.
 */
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { softBatch } from './softBatch.js';

export class RefactorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefactorError';
  }
}

/** One pass's contribution to the candidate. */
export interface PassOutcome {
  /** Pass name, e.g. "soft-batch". */
  name: string;
  /** Short human summary of what it did, e.g. "softened 4 assertions". */
  detail: string;
}

export interface RefactorResult {
  /** Absolute path of the written candidate, or null when nothing changed. */
  candidatePath: string | null;
  /** The (possibly) rewritten source. */
  code: string;
  /** The original spec, returned so callers can diff without re-reading. */
  original: string;
  /** Whether any pass changed the spec. */
  changed: boolean;
  /** What each pass that fired contributed. */
  passes: PassOutcome[];
}

/**
 * Refactor a single spec. Reads `<devRoot>/__vibe_tests__/<slug>.spec.ts`,
 * runs the passes in order (each fed the previous pass's output), and writes a
 * `.draft` candidate iff the spec changed.
 */
export async function refactorSpec(devRoot: string, slug: string): Promise<RefactorResult> {
  const specPath = join(devRoot, '__vibe_tests__', `${slug}.spec.ts`);
  let original: string;
  try {
    original = await readFile(specPath, 'utf-8');
  } catch {
    throw new RefactorError(`spec not found: ${slug} (looked at ${specPath})`);
  }

  let code = original;
  const passes: PassOutcome[] = [];

  // soft-batch — the only pass shipped today. group-by-route and beforeEach
  // hoist (cross-spec) plug in here as they land.
  const soft = softBatch(code);
  if (soft.changed) {
    code = soft.code;
    passes.push({
      name: 'soft-batch',
      detail: `softened ${soft.softened} trailing assertion${soft.softened === 1 ? '' : 's'}`,
    });
  }

  const changed = code !== original;
  if (!changed) {
    return { candidatePath: null, code, original, changed: false, passes };
  }

  const dir = join(devRoot, '__vibe_tests__', '.hover', 'restructured');
  await mkdir(dir, { recursive: true });
  // `.spec.ts.draft`, never `*.spec.ts` — Playwright's glob must not collect a
  // candidate before a human reviews it.
  const candidatePath = join(dir, `${slug}.spec.ts.draft`);
  await writeFile(candidatePath, code.endsWith('\n') ? code : `${code}\n`, 'utf-8');
  return { candidatePath, code, original, changed: true, passes };
}

function candidatePathFor(devRoot: string, slug: string): string {
  return join(devRoot, '__vibe_tests__', '.hover', 'restructured', `${slug}.spec.ts.draft`);
}

/** Promote a refactor candidate to the real spec and remove the candidate. */
export async function promoteRefactored(devRoot: string, slug: string): Promise<string> {
  const candidate = candidatePathFor(devRoot, slug);
  const specPath = join(devRoot, '__vibe_tests__', `${slug}.spec.ts`);
  let code: string;
  try {
    code = await readFile(candidate, 'utf-8');
  } catch {
    throw new RefactorError(`no refactor candidate to promote for "${slug}"`);
  }
  await writeFile(specPath, code, 'utf-8');
  await rm(candidate, { force: true });
  return specPath;
}

/** Discard a refactor candidate (delete the .draft, leave the spec). */
export async function discardRefactored(devRoot: string, slug: string): Promise<void> {
  await rm(candidatePathFor(devRoot, slug), { force: true });
}
