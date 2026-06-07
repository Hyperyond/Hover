/**
 * soft-batch — a deterministic finishing step of the optimization pass.
 *
 * After the LLM optimize pass decides WHAT to assert (it reads the observed
 * feedback and adds the trailing "Then" assertions), this step applies the safe
 * mechanical rewrite: the maximal *trailing run* of independent assertions in
 * each `test()` body goes from `expect(...)` to `expect.soft(...)`, so a
 * field-audit spec reports every failing field in one run instead of halting on
 * the first. This is the "LLM decides, AST executes" split — the LLM never
 * reprints the file to do it, so it can't drift; ts-morph applies the soften
 * surgically and every untouched node stays byte-identical.
 *
 * Two assertion shapes are recognised, because that is what specs look like
 * after optimize:
 *   A. a bare `await expect(...)....` statement;
 *   B. a Hover `await test.step('Then · …', async () => { await expect(...) })`
 *      closure whose body is nothing but assertions — Hover emits one such step
 *      per observed-feedback assertion, AFTER all the action steps.
 *
 * Safety guard (why this is deterministic and never changes test semantics):
 * we only ever soften an assertion that sits in the trailing run — the suffix
 * of the test body that is assertions all the way down, with no action after
 * it. A *gating* assertion — one a later action depends on — is by construction
 * followed by that action, so it never lands in the trailing run and is never
 * softened. Softening only changes how failures are *reported* (all collected
 * vs. stop-on-first), never whether the test passes. We require ≥2 assertions
 * in the run: soft buys nothing for a single one. `expect.soft` collects across
 * the whole test regardless of `test.step` nesting, so softening step-wrapped
 * assertions is sound.
 */
import { Project, SyntaxKind, Node, type SourceFile, type Statement } from 'ts-morph';

/** A trailing run with fewer than this many assertions is left alone —
 *  `expect.soft` only earns its keep when ≥2 failures could be collected. */
export const MIN_RUN = 2;

export interface SoftBatchResult {
  /** The (possibly) rewritten source. */
  code: string;
  /** Whether anything changed. */
  changed: boolean;
  /** How many assertions were softened across all tests. */
  softened: number;
}

/** Run the soft-batch step over a spec's source text. Pure: text in, text out. */
export function softBatch(source: string): SoftBatchResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  });
  const sf = project.createSourceFile('__spec.ts', source, { overwrite: true });

  // Collect every assertion to soften first (across all test bodies), then
  // apply — each edit is a localized identifier replace, so sibling targets
  // stay valid.
  const targets: Statement[] = [];
  for (const body of testBodies(sf)) {
    const run = trailingAssertionRun(body.getStatements());
    const asserts = run.flatMap(bareAssertionsIn);
    if (asserts.length >= MIN_RUN) targets.push(...asserts);
  }

  let softened = 0;
  for (const stmt of targets) {
    if (soften(stmt)) softened++;
  }

  return { code: sf.getFullText(), changed: softened > 0, softened };
}

/**
 * Yield the block body of every `test(...)` call (including `test.only` /
 * `.skip` / `.fixme`), but NOT `test.describe` / hooks — those wrap tests, they
 * aren't a test body.
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

/** The longest suffix of `statements` that are all assertion units (a bare
 *  assertion, or a `test.step` whose body is only assertions). */
function trailingAssertionRun(statements: Statement[]): Statement[] {
  const run: Statement[] = [];
  for (let i = statements.length - 1; i >= 0; i--) {
    if (!isAssertionUnit(statements[i])) break;
    run.unshift(statements[i]);
  }
  return run;
}

/** A statement that contributes only assertions: a bare assertion (case A) or
 *  an assertion-only `test.step` closure (case B). */
function isAssertionUnit(stmt: Statement): boolean {
  return isBareAssertion(stmt) || bareAssertionsInStep(stmt) !== null;
}

/** The bare-assertion statements a unit contains: itself (case A) or the
 *  assertions inside its `test.step` closure (case B). */
function bareAssertionsIn(stmt: Statement): Statement[] {
  if (isBareAssertion(stmt)) return [stmt];
  return bareAssertionsInStep(stmt) ?? [];
}

/** True if the statement is `(await) expect(...)....` — its call chain bottoms
 *  out at an `expect` identifier. */
function isBareAssertion(stmt: Statement): boolean {
  if (!Node.isExpressionStatement(stmt)) return false;
  let expr: Node = stmt.getExpression();
  if (Node.isAwaitExpression(expr)) expr = expr.getExpression();
  return leftmostBase(expr) === 'expect';
}

/**
 * If `stmt` is `await test.step(label, async () => { …only assertions… })`,
 * return those inner assertion statements; otherwise null. The closure body
 * must be non-empty and contain ONLY bare assertions — a step that also acts
 * (a "When" with a check) is not a pure assertion unit and is left alone.
 */
function bareAssertionsInStep(stmt: Statement): Statement[] | null {
  if (!Node.isExpressionStatement(stmt)) return null;
  let expr: Node = stmt.getExpression();
  if (Node.isAwaitExpression(expr)) expr = expr.getExpression();
  if (!Node.isCallExpression(expr)) return null;
  const callee = expr.getExpression();
  if (
    !Node.isPropertyAccessExpression(callee) ||
    callee.getName() !== 'step' ||
    callee.getExpression().getText() !== 'test'
  ) {
    return null;
  }
  const cb = expr.getArguments().at(-1);
  if (!cb || !(Node.isArrowFunction(cb) || Node.isFunctionExpression(cb))) return null;
  const block = cb.getBody();
  if (!Node.isBlock(block)) return null;
  const inner = block.getStatements();
  if (inner.length === 0 || !inner.every(isBareAssertion)) return null;
  return inner;
}

/** Descend a call/member chain to its leftmost identifier, e.g.
 *  `expect(x).toHaveText(y)` → "expect", `page.goto('/')` → "page". */
function leftmostBase(node: Node): string | null {
  let cur: Node | undefined = node;
  while (cur && (Node.isCallExpression(cur) || Node.isPropertyAccessExpression(cur))) {
    cur = cur.getExpression();
  }
  return cur && Node.isIdentifier(cur) ? cur.getText() : null;
}

/** Rewrite the `expect(` call inside a bare assertion statement to
 *  `expect.soft(`. Skips ones already soft (their callee is `expect.soft`, not
 *  the bare identifier `expect`). Returns whether a change was made. */
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
