/**
 * `hover optimize <spec>` — run the optional LLM optimization pass (Stage 7 /
 * F7) over a saved spec. The agent reads the spec + its captured session and
 * proposes improvements (chiefly: assertions for the feedback the session
 * observed). The result is validated and written as a CANDIDATE under
 * .hover/optimized/<slug>.spec.ts.draft; a git diff is printed for review. The
 * original spec is never overwritten — you promote or discard it by hand.
 *
 * Dynamically imports the project's installed @hover-dev/core (same resolution
 * trick as re-record / extract) so the CLI stays a zero-dependency binary.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bold, cyan, dim, err, ok, head, line, gap, done, tail } from './log.js';

interface OptimizeArgs {
  spec: string;
  cwd: string | null;
}

export async function runOptimize(args: OptimizeArgs): Promise<number> {
  const cwd = args.cwd
    ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
    : process.cwd();
  if (args.cwd && !existsSync(cwd)) {
    err(`--cwd path does not exist: ${cwd}`);
    return 1;
  }

  const slug = args.spec.replace(/\.spec\.ts$/, '');
  head(`${bold('hover optimize')} ${dim('·')} ${cyan(slug)}`);
  gap();
  const origPath = join(cwd, '__vibe_tests__', `${slug}.spec.ts`);
  if (!existsSync(origPath)) {
    err(`No spec found at ${cyan(relative(cwd, origPath))}.`);
    return 1;
  }

  let entry: string;
  try {
    entry = resolveOptimizeEntry(cwd);
  } catch (e) {
    err(`Couldn't find ${cyan('@hover-dev/core')} in ${cyan(cwd)}.`);
    err(`Install Hover for this project first: ${cyan('npx @hover-dev/cli setup')}.`);
    err(`Original error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const { optimizeSpecWithAgent } = (await import(entry)) as {
    optimizeSpecWithAgent: (
      devRoot: string,
      slug: string,
      opts: { agentId: string; model?: string; maxBudgetUsd?: number },
    ) => Promise<{ candidatePath: string; code: string }>;
  };

  line('reading the spec + captured session, proposing improvements…');
  let res: { candidatePath: string; code: string };
  try {
    res = await optimizeSpecWithAgent(cwd, slug, {
      agentId: process.env.HOVER_AGENT ?? 'claude',
      model: process.env.HOVER_MODEL ?? 'sonnet',
      maxBudgetUsd: 0.5,
    });
  } catch (e) {
    err(`Optimize failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  ok(`candidate written ${dim('→')} ${cyan(relative(cwd, res.candidatePath))}`);
  gap();
  line(dim('diff (original → optimized):'));
  gap();
  const diff = spawnSync(
    'git',
    ['diff', '--no-index', '--', origPath, res.candidatePath],
    { cwd, encoding: 'utf-8' },
  );
  console.log(diff.stdout || dim('(git diff unavailable — open the candidate to compare)'));
  gap();
  done('Candidate ready for review');
  line(`${bold('promote')}  ${cyan(`mv "${relative(cwd, res.candidatePath)}" "${relative(cwd, origPath)}"`)}`);
  line(`${bold('discard')}  ${cyan(`rm "${relative(cwd, res.candidatePath)}"`)}`);
  tail(dim('the original spec is untouched — it still runs in CI'));
  return 0;
}

function resolveOptimizeEntry(cwd: string): string {
  let dir = cwd;
  for (;;) {
    const candidate = join(
      dir, 'node_modules', '@hover-dev', 'core', 'dist', 'specs', 'optimizeSpecWithAgent.js',
    );
    if (existsSync(candidate)) return `file://${candidate}`;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('@hover-dev/core not found in any ancestor node_modules/');
}

export function parseOptimizeArgs(argv: string[]): { args: OptimizeArgs | null; exitCode: number } {
  const out: OptimizeArgs = { spec: '', cwd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd' || a === '-C') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) { err(`${a} requires a path argument.`); return { args: null, exitCode: 2 }; }
      out.cwd = next; i++;
    } else if (a.startsWith('--cwd=')) {
      out.cwd = a.slice('--cwd='.length);
    } else if (a.startsWith('-')) {
      err(`Unknown flag for optimize: ${a}`);
      return { args: null, exitCode: 2 };
    } else if (!out.spec) {
      out.spec = a;
    } else {
      err(`Unexpected extra argument: ${a}`);
      return { args: null, exitCode: 2 };
    }
  }
  if (!out.spec) {
    err(`Usage: hover optimize <spec> [--cwd <path>]`);
    return { args: null, exitCode: 2 };
  }
  return { args: out, exitCode: 0 };
}
