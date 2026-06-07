import { describe, it, expect } from 'vitest';
import { softBatch } from '../../src/specs/softBatch.js';

const HEAD = `import { test, expect } from '@playwright/test';\n\n`;

/** Wrap statements in a single test body. */
function spec(body: string): string {
  return `${HEAD}test('t', async ({ page }) => {\n${body}\n});\n`;
}

describe('softBatch', () => {
  it('softens a maximal trailing run of independent assertions', () => {
    const src = spec(
      `  await page.goto('/checkout/summary');\n` +
      `  const region = page.getByRole('region', { name: 'Order Summary' });\n` +
      `  await expect(region.getByTestId('coupon-code')).toHaveText('SAVE10');\n` +
      `  await expect(region.getByRole('cell', { name: 'Fee' })).toHaveText('$5');\n` +
      `  await expect(region.getByTestId('total')).toHaveText('$55');`,
    );
    const res = softBatch(src);
    expect(res.changed).toBe(true);
    expect(res.softened).toBe(3);
    expect(res.code).toContain(`expect.soft(region.getByTestId('coupon-code'))`);
    expect(res.code).toContain(`expect.soft(region.getByTestId('total'))`);
    // the action + scope decl are untouched
    expect(res.code).toContain(`await page.goto('/checkout/summary');`);
    expect(res.code).toContain(`const region = page.getByRole('region', { name: 'Order Summary' });`);
  });

  it('does NOT soften a gating assertion — one followed by an action', () => {
    const src = spec(
      `  await page.goto('/');\n` +
      `  await expect(page.getByText('Logged in')).toBeVisible();\n` + // gating: action follows
      `  await page.getByRole('button', { name: 'Checkout' }).click();\n` +
      `  await expect(page.getByTestId('total')).toHaveText('$55');\n` + // trailing run of 2…
      `  await expect(page.getByTestId('tax')).toHaveText('$5');`,
    );
    const res = softBatch(src);
    // only the trailing run (total, tax) softens; the gating visibility stays hard
    expect(res.softened).toBe(2);
    expect(res.code).toContain(`await expect(page.getByText('Logged in')).toBeVisible();`);
    expect(res.code).toContain(`expect.soft(page.getByTestId('total'))`);
    expect(res.code).toContain(`expect.soft(page.getByTestId('tax'))`);
  });

  it('leaves a single trailing assertion alone (soft buys nothing)', () => {
    const src = spec(
      `  await page.goto('/');\n` +
      `  await page.getByRole('button', { name: '+ 1' }).click();\n` +
      `  await expect(page.getByTestId('count')).toHaveText('01');`,
    );
    const res = softBatch(src);
    expect(res.changed).toBe(false);
    expect(res.code).toBe(src);
  });

  it('no-ops a spec with no assertions', () => {
    const src = spec(`  await page.goto('/');\n  await page.getByRole('button').click();`);
    expect(softBatch(src).changed).toBe(false);
  });

  it('does not double-soften assertions already soft', () => {
    const src = spec(
      `  await expect.soft(page.getByTestId('a')).toHaveText('1');\n` +
      `  await expect(page.getByTestId('b')).toHaveText('2');`,
    );
    const res = softBatch(src);
    expect(res.softened).toBe(1); // only the bare `expect` becomes soft
    expect((res.code.match(/expect\.soft/g) ?? []).length).toBe(2);
    expect(res.code).not.toContain(`expect.soft.soft`);
  });

  it('handles each test in a describe independently', () => {
    const src =
      `${HEAD}test.describe('s', () => {\n` +
      `  test('a', async ({ page }) => {\n` +
      `    await page.goto('/');\n` +
      `    await expect(page.getByTestId('x')).toHaveText('1');\n` +
      `    await expect(page.getByTestId('y')).toHaveText('2');\n` +
      `  });\n` +
      `  test('b', async ({ page }) => {\n` +
      `    await page.goto('/');\n` +
      `    await expect(page.getByTestId('z')).toHaveText('3');\n` + // single → untouched
      `  });\n` +
      `});\n`;
    const res = softBatch(src);
    expect(res.softened).toBe(2); // both in test 'a', none in 'b'
    expect(res.code).toContain(`expect.soft(page.getByTestId('x'))`);
    expect(res.code).toContain(`await expect(page.getByTestId('z'))`); // 'b' stays hard
  });

  it('softens a trailing run of Hover test.step("Then · …") assertion closures', () => {
    // The real Hover emit: one assertion per `await test.step('Then · …')`,
    // all after the action steps.
    const src =
      `${HEAD}test('checkout summary', async ({ page }) => {\n` +
      `  await test.step('When · open summary', async () => {\n` +
      `    await page.goto('/checkout/summary');\n` +
      `  });\n` +
      `  await test.step('Then · coupon', async () => {\n` +
      `    await expect(page.getByTestId('coupon-code')).toHaveText('SAVE10');\n` +
      `  });\n` +
      `  await test.step('Then · total', async () => {\n` +
      `    await expect(page.getByTestId('total')).toHaveText('$55');\n` +
      `  });\n` +
      `});\n`;
    const res = softBatch(src);
    expect(res.changed).toBe(true);
    expect(res.softened).toBe(2);
    expect(res.code).toContain(`expect.soft(page.getByTestId('coupon-code'))`);
    expect(res.code).toContain(`expect.soft(page.getByTestId('total'))`);
    // the action step is untouched
    expect(res.code).toContain(`await page.goto('/checkout/summary');`);
  });

  it('does NOT soften a Then-step that is gated by a later action step', () => {
    const src =
      `${HEAD}test('gated', async ({ page }) => {\n` +
      `  await test.step('Then · logged in', async () => {\n` +
      `    await expect(page.getByText('Logged in')).toBeVisible();\n` + // gating
      `  });\n` +
      `  await test.step('When · checkout', async () => {\n` +
      `    await page.getByRole('button', { name: 'Checkout' }).click();\n` +
      `  });\n` +
      `  await test.step('Then · total', async () => {\n` +
      `    await expect(page.getByTestId('total')).toHaveText('$55');\n` +
      `  });\n` +
      `});\n`;
    // only one trailing assertion-step (total) → run of 1 → nothing softened
    const res = softBatch(src);
    expect(res.changed).toBe(false);
    expect(res.code).toContain(`await expect(page.getByText('Logged in')).toBeVisible();`);
  });

  it('does not soften a test.step that also performs an action', () => {
    const src =
      `${HEAD}test('mixed', async ({ page }) => {\n` +
      `  await test.step('When · click + check', async () => {\n` +
      `    await page.getByRole('button').click();\n` +
      `    await expect(page.getByTestId('a')).toHaveText('1');\n` +
      `  });\n` +
      `  await test.step('Then · b', async () => {\n` +
      `    await expect(page.getByTestId('b')).toHaveText('2');\n` +
      `  });\n` +
      `});\n`;
    // the mixed step isn't a pure assertion unit, so the trailing run is just
    // the single pure Then-step → run of 1 → no change
    expect(softBatch(src).changed).toBe(false);
  });

  it('ignores assertions outside a test() (e.g. in a helper)', () => {
    const src =
      `${HEAD}function check(page) {\n` +
      `  expect(page.getByTestId('a')).toBeTruthy();\n` +
      `  expect(page.getByTestId('b')).toBeTruthy();\n` +
      `}\n` +
      `test('t', async ({ page }) => { await page.goto('/'); });\n`;
    expect(softBatch(src).changed).toBe(false);
  });
});
