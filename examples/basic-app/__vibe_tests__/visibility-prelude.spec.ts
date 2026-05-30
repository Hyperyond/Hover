import { test, expect } from '@playwright/test';

/**
 * Hover v0.13 visibility prelude — reproduction.
 *
 * Demonstrates what the new `writeSpec` emit shape (`{ const el = …; await
 * expect(el).toBeVisible(); await el.click(); }`) actually buys vs the
 * pre-v0.13 one-liner (`await page.getByRole(...).click()`).
 *
 * Pairs with `visibility-prelude-old-emit.spec.ts` which runs the SAME
 * scenarios with the pre-v0.13 emit shape. Run both and compare wall
 * times in the output:
 *
 *   pnpm --filter basic-app exec playwright test visibility-prelude
 *
 * On the drift-mode side, the v0.13 spec fails in roughly 5 s per case
 * with a clean "Locator expected to be visible" message; the pre-v0.13
 * spec takes ~30 s per case and reports a generic actionability timeout
 * that reads like a flake.
 *
 * Net detection is the same — Playwright already catches the case via
 * actionability. The prelude is a *speed + categorisation* improvement,
 * not net-new bug detection. See docs/faq.md → "My button is still in
 * the DOM but moved behind a kebab menu — does the spec catch that?"
 */

// Drift mode is toggled via URL query string (see src/visibility-lab.tsx).
// Picking the URL over localStorage makes the scene deterministic for
// Playwright's fresh-context-per-test execution model.
const DRIFT_OFF = '/';
const DRIFT_ON = '/?drift=on';

// Trim every per-step actionability budget down hard so the failure path
// is fast even under the OLD emit shape. The PRELUDE assertions get an
// explicit short timeout below; this default mostly affects `.click()`
// inside actionability.
test.use({ actionTimeout: 6000 });

test.describe('v0.13 visibility prelude (NEW emit shape) — drift OFF (baseline)', () => {
  test('Save changes button is visible and clickable', async ({ page }) => {
    await page.goto(DRIFT_OFF);
    {
      const el = page.getByRole('button', { name: 'Save changes' });
      await expect(el).toBeVisible();
      await el.click();
    }
    await expect(page.getByTestId('last-clicked')).toContainText('Save changes');
  });

  test('Apply coupon is visible and clickable', async ({ page }) => {
    await page.goto(DRIFT_OFF);
    {
      const el = page.getByRole('button', { name: 'Apply coupon' });
      await expect(el).toBeVisible();
      await el.click();
    }
    await expect(page.getByTestId('last-clicked')).toContainText('Apply coupon');
  });

  test('Subscribe is visible and clickable', async ({ page }) => {
    await page.goto(DRIFT_OFF);
    {
      const el = page.getByRole('button', { name: 'Subscribe' });
      await expect(el).toBeVisible();
      await el.click();
    }
    await expect(page.getByTestId('last-clicked')).toContainText('Subscribe');
  });
});

test.describe('v0.13 visibility prelude (NEW emit shape) — drift ON (regression scene)', () => {
  // These tests intentionally FAIL when drift is ON — that's the whole point
  // of the reproduction. We mark them as `.fail()` so the suite stays green
  // on `pnpm test:e2e` (they're an expected failure under drift mode) while
  // still exercising the failure path so users can inspect the wall time +
  // error message.

  test.fail('Save changes button — kebab menu (closed <details>)', async ({ page }) => {
    await page.goto(DRIFT_ON);
    {
      const el = page.getByRole('button', { name: 'Save changes' });
      // Short toBeVisible timeout so the failure surfaces fast — this is
      // the whole point of the prelude. Default would be 5s; we use 3s
      // here to make the speed contrast with the old emit obvious.
      await expect(el).toBeVisible({ timeout: 3000 });
      await el.click();
    }
  });

  test.fail('Apply coupon — display: none', async ({ page }) => {
    await page.goto(DRIFT_ON);
    {
      const el = page.getByRole('button', { name: 'Apply coupon' });
      await expect(el).toBeVisible({ timeout: 3000 });
      await el.click();
    }
  });

  test.fail('Subscribe — visibility: hidden', async ({ page }) => {
    await page.goto(DRIFT_ON);
    {
      const el = page.getByRole('button', { name: 'Subscribe' });
      await expect(el).toBeVisible({ timeout: 3000 });
      await el.click();
    }
  });
});
