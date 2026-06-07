/**
 * `hover refactor [spec]` — run the deterministic architecture passes over
 * saved specs (today: soft-batch). Each changed spec is written as a CANDIDATE
 * under .hover/restructured/<slug>.spec.ts.draft and a git diff is printed for
 * review; the original is never overwritten. With no <spec>, every spec is
 * scanned and only the ones that change are reported.
 *
 * Unlike `optimize`, this is fully deterministic and zero-token — no agent, no
 * model, no network. So there's no --agent / --model / budget here.
 *
 * Dynamically imports the project's installed @hover-dev/core (same resolution
 * trick as optimize / extract) so the CLI stays a zero-dependency binary.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bold, cyan, dim, err, ok, warn, head, line, gap, done, tail } from './log.js';

interface RefactorArgs {
  /** A specific spec slug, or null to scan every spec. */
  spec: string | null;
  cwd: string | null;
}

interface PassOutcome { name: string; detail: string; }
interface RefactorResult {
  candidatePath: string | null;
  code: string;
  original: string;
  changed: boolean;
  passes: PassOutcome[];
}

export async function runRefactor(args: RefactorArgs): Promise<number> {
  const cwd = args.cwd
    ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
    : process.cwd();
  if (args.cwd && !existsSync(cwd)) {
    err(`--cwd path does not exist: ${cwd}`);
    return 1;
  }

  const label = args.spec ? `${dim('·')} ${cyan(args.spec.replace(/\.spec\.ts$/, ''))}` : dim('· all specs');
  head(`${bold('hover refactor')} ${label}`);
  gap();

  let base: string;
  try {
    base = resolveCoreDist(cwd);
  } catch (e) {
    err(`Couldn't find ${cyan('@hover-dev/core')} in ${cyan(cwd)}.`);
    err(`Install Hover for this project first: ${cyan('npx @hover-dev/cli setup')}.`);
    err(`Original error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const { refactorSpec } = (await import(`${base}/specs/restructure/refactorSpec.js`)) as {
    refactorSpec: (devRoot: string, slug: string) => Promise<RefactorResult>;
  };

  // Resolve the slug list: the one requested, or every saved spec.
  let slugs: string[];
  if (args.spec) {
    const slug = args.spec.replace(/\.spec\.ts$/, '');
    const origPath = join(cwd, '__vibe_tests__', `${slug}.spec.ts`);
    if (!existsSync(origPath)) {
      err(`No spec found at ${cyan(relative(cwd, origPath))}.`);
      return 1;
    }
    slugs = [slug];
  } else {
    const { listSpecs } = (await import(`${base}/specs/listSpecs.js`)) as {
      listSpecs: (devRoot: string) => Promise<{ slug: string }[]>;
    };
    slugs = (await listSpecs(cwd)).map(s => s.slug);
    if (slugs.length === 0) {
      warn(`No specs found under ${cyan('__vibe_tests__/')}.`);
      tail(dim('record a session first, then refactor it'));
      return 0;
    }
    line(`scanning ${bold(String(slugs.length))} spec${slugs.length === 1 ? '' : 's'}…`);
    gap();
  }

  const changed: RefactorResult[] = [];
  for (const slug of slugs) {
    let res: RefactorResult;
    try {
      res = await refactorSpec(cwd, slug);
    } catch (e) {
      err(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (res.changed && res.candidatePath) {
      changed.push(res);
      const what = res.passes.map(p => p.detail).join(', ');
      ok(`${cyan(slug)} ${dim('—')} ${what}`);
    }
  }

  if (changed.length === 0) {
    gap();
    done('Nothing to refactor');
    tail(dim('every spec already has the structure these passes would produce'));
    return 0;
  }

  for (const res of changed) {
    const origPath = join(cwd, '__vibe_tests__', `${relativeSlug(res)}.spec.ts`);
    gap();
    line(dim(`diff (original → refactored): ${relative(cwd, origPath)}`));
    gap();
    const diff = spawnSync(
      'git',
      ['diff', '--no-index', '--', origPath, res.candidatePath!],
      { cwd, encoding: 'utf-8' },
    );
    console.log(diff.stdout || dim('(git diff unavailable — open the candidate to compare)'));
  }

  gap();
  done(`${changed.length} candidate${changed.length === 1 ? '' : 's'} ready for review`);
  for (const res of changed) {
    const slug = relativeSlug(res);
    const cand = relative(cwd, res.candidatePath!);
    const orig = relative(cwd, join(cwd, '__vibe_tests__', `${slug}.spec.ts`));
    line(`${bold('promote')}  ${cyan(`mv "${cand}" "${orig}"`)}`);
  }
  tail(dim('originals are untouched — they still run in CI'));
  return 0;
}

/** Recover a slug from a candidate path: `.../restructured/<slug>.spec.ts.draft`. */
function relativeSlug(res: RefactorResult): string {
  return res.candidatePath!.replace(/^.*[/\\]/, '').replace(/\.spec\.ts\.draft$/, '');
}

/** Walk ancestor node_modules/ for the installed core's dist dir (file:// URL base). */
function resolveCoreDist(cwd: string): string {
  let dir = cwd;
  for (;;) {
    const distDir = join(dir, 'node_modules', '@hover-dev', 'core', 'dist');
    if (existsSync(join(distDir, 'specs', 'restructure', 'refactorSpec.js'))) {
      return `file://${distDir}`;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('@hover-dev/core not found in any ancestor node_modules/');
}

export function parseRefactorArgs(argv: string[]): { args: RefactorArgs | null; exitCode: number } {
  const out: RefactorArgs = { spec: null, cwd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd' || a === '-C') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) { err(`${a} requires a path argument.`); return { args: null, exitCode: 2 }; }
      out.cwd = next; i++;
    } else if (a.startsWith('--cwd=')) {
      out.cwd = a.slice('--cwd='.length);
    } else if (a.startsWith('-')) {
      err(`Unknown flag for refactor: ${a}`);
      return { args: null, exitCode: 2 };
    } else if (out.spec === null) {
      out.spec = a;
    } else {
      err(`Unexpected extra argument: ${a}`);
      return { args: null, exitCode: 2 };
    }
  }
  return { args: out, exitCode: 0 };
}
