/**
 * Architecture pass — soft-batch.
 *
 * Rewrites the maximal *trailing run* of consecutive independent assertions in
 * each `test()` body from `expect(...)` to `expect.soft(...)`, so a field-audit
 * spec reports every failing field in one run instead of halting on the first.
 *
 * Safety guard (why this is deterministic and never changes test semantics):
 * we only ever soften a run of assertions that sits at the very END of a test
 * body, with no action after it. A *gating* assertion — one a later action
 * depends on — is by construction followed by that action, so it never lands in
 * the trailing run and is never softened. Softening a trailing run only changes
 * how failures are *reported* (all collected vs. stop-on-first), never whether
 * the test passes. A run of length 1 is left alone: soft buys nothing there.
 *
 * AST is the scalpel, not the judge: the trailing-run rule decides WHAT to
 * change; ts-morph applies it surgically so every untouched node stays
 * byte-identical (minimal diff for human review).
 */
import { Project, SyntaxKind, Node, type SourceFile, type Statement } from 'ts-morph';

/** A trailing run shorter than this is left alone — `expect.soft` only earns
 *  its keep when ≥2 failures could be collected in one pass. */
export const MIN_RUN = 2;

export interface SoftBatchResult {
  /** The (possibly) rewritten source. */
  code: string;
  /** Whether anything changed. */
  changed: boolean;
  /** How many assertions were softened across all tests. */
  softened: number;
}

/** Run the soft-batch pass over a spec's source text. Pure: text in, text out. */
export function softBatch(source: string): SoftBatchResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    // Don't let the parser reformat untouched code — we want a minimal diff.
    compilerOptions: { allowJs: true },
  });
  const sf = project.createSourceFile('__spec.ts', source, { overwrite: true });

  let softened = 0;
  for (const body of testBodies(sf)) {
    const statements = body.getStatements();
    const run = trailingAssertionRun(statements);
    if (run.length < MIN_RUN) continue;
    for (const stmt of run) {
      if (soften(stmt)) softened++;
    }
  }

  return { code: sf.getFullText(), changed: softened > 0, softened };
}

/**
 * Yield the block body of every `test(...)` call (including `test.only` /
 * `.skip` / `.fixme`), but NOT `test.describe` / hooks — those wrap tests, they
 * aren't a test body. We walk all `test`-rooted calls and keep the ones whose
 * member (if any) is a test variant.
 */
function testBodies(sf: SourceFile): { getStatements(): Statement[] }[] {
  const bodies: { getStatements(): Statement[] }[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isTestCall(call.getExpression())) continue;
    const cb = call.getArguments().at(-1);
    if (!cb) continue;
    if (Node.isArrowFunction(cb) || Node.isFunctionExpression(cb)) {
      const block = cb.getBody();
      if (Node.isBlock(block)) bodies.push(block);
    }
  }
  return bodies;
}

/** `test` | `test.only` | `test.skip` | `test.fixme` — not `test.describe` or hooks. */
function isTestCall(callee: Node): boolean {
  if (Node.isIdentifier(callee)) return callee.getText() === 'test';
  if (Node.isPropertyAccessExpression(callee)) {
    const base = callee.getExpression();
    if (!Node.isIdentifier(base) || base.getText() !== 'test') return false;
    return ['only', 'skip', 'fixme'].includes(callee.getName());
  }
  return false;
}

/** The longest suffix of `statements` that are all assertion statements. */
function trailingAssertionRun(statements: Statement[]): Statement[] {
  const run: Statement[] = [];
  for (let i = statements.length - 1; i >= 0; i--) {
    if (!isAssertionStatement(statements[i])) break;
    run.unshift(statements[i]);
  }
  return run;
}

/** True if the statement is `(await) expect(...)....` — its call chain bottoms
 *  out at an `expect` identifier. `const x = ...` and `await locator.click()`
 *  are not assertions, so they break the trailing run. */
function isAssertionStatement(stmt: Statement): boolean {
  if (!Node.isExpressionStatement(stmt)) return false;
  let expr: Node = stmt.getExpression();
  if (Node.isAwaitExpression(expr)) expr = expr.getExpression();
  return leftmostBase(expr) === 'expect';
}

/** Descend a call/member chain to its leftmost identifier, e.g.
 *  `expect(x).toHaveText(y)` → "expect", `page.goto('/')` → "page". */
function leftmostBase(node: Node): string | null {
  let cur: Node | undefined = node;
  while (cur) {
    if (Node.isCallExpression(cur) || Node.isPropertyAccessExpression(cur)) {
      cur = cur.getExpression();
      continue;
    }
    break;
  }
  return cur && Node.isIdentifier(cur) ? cur.getText() : null;
}

/** Rewrite the `expect(` call inside an assertion statement to `expect.soft(`.
 *  Skips ones already soft (their callee is `expect.soft`, not the bare
 *  identifier `expect`). Returns whether a change was made. */
function soften(stmt: Statement): boolean {
  for (const call of stmt.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isIdentifier(callee) && callee.getText() === 'expect') {
      callee.replaceWithText('expect.soft');
      return true;
    }
  }
  return false;
}
