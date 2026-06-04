/**
 * `hover extract` — lift Page Objects + fixtures from flows shared across
 * saved specs (Stage 3, F4).
 *
 * Pure filesystem: reads the `.hover/*.json` sidecars under
 * `<cwd>/__vibe_tests__/`, detects entry flows shared by >= 3 specs, and
 * writes `pages/<Name>.ts` + a single `fixtures.ts`. Unlike `re-record`, it
 * never boots a service or drives Chrome — no agent, no tokens.
 *
 * It dynamically imports the consuming project's installed
 * `@hover-dev/core/dist/specs/extractPageObjects.js` (same resolution trick as
 * re-record) so the CLI stays a zero-dependency, fast-cold-start binary.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { bold, cyan, dim, err, info, ok, spark, warn } from './log.js';

export async function runExtract(args: { cwd: string | null; minSpecs: number }): Promise<number> {
  const cwd = args.cwd
    ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
    : process.cwd();
  if (args.cwd && !existsSync(cwd)) {
    err(`--cwd path does not exist: ${cwd}`);
    return 1;
  }

  let entry: string;
  try {
    entry = resolveExtractEntry(cwd);
  } catch (e) {
    err(`Couldn't find ${cyan('@hover-dev/core')} in ${cyan(cwd)}.`);
    err(`Install Hover for this project first: ${cyan('npx @hover-dev/cli add')}.`);
    err(`Original error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const { extractPageObjects } = (await import(entry)) as {
    extractPageObjects: (
      devRoot: string,
      opts?: { minSpecs?: number },
    ) => Promise<{
      pages: { className: string; path: string; specs: string[] }[];
      fixturesPath: string | null;
    }>;
  };

  info(`Scanning saved specs for flows shared by ${bold(String(args.minSpecs))}+ specs…`);
  const res = await extractPageObjects(cwd, { minSpecs: args.minSpecs });

  if (res.pages.length === 0) {
    warn(`No flow is shared by ${args.minSpecs}+ specs yet — nothing to extract.`);
    info(`Save a few specs that start the same way (e.g. log in), then re-run.`);
    return 0;
  }

  for (const p of res.pages) {
    ok(`${bold(p.className)} ${dim('←')} ${p.specs.join(', ')}`);
    info(`  ${cyan(relative(cwd, p.path))}`);
  }
  if (res.fixturesPath) {
    info(`Fixtures: ${cyan(relative(cwd, res.fixturesPath))}`);
  }
  spark(
    `Done. New specs can ${bold("import { test, expect } from './fixtures'")} and use the page objects.`,
  );
  return 0;
}

/**
 * Walk up from `cwd` for node_modules/@hover-dev/core/dist/specs/
 * extractPageObjects.js. Returns a file:// URL ready for dynamic import. Uses
 * the explicit dist path (not the package's exports map) to avoid pnpm
 * hoisting surprises — same convention as re-record's resolveCoreEntry.
 */
function resolveExtractEntry(cwd: string): string {
  let dir = cwd;
  for (;;) {
    const candidate = join(
      dir, 'node_modules', '@hover-dev', 'core', 'dist', 'specs', 'extractPageObjects.js',
    );
    if (existsSync(candidate)) return `file://${candidate}`;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('@hover-dev/core not found in any ancestor node_modules/');
}
