import { test, expect } from '@playwright/test';

/**
 * Hover pre-v0.13 emit shape — what the same scenario looks like without
 * the visibility prelude. Pairs with `visibility-prelude.spec.ts` for
 * side-by-side comparison.
 *
 * Each interaction is a one-liner — `await page.getByRole(...).click()`
 * — exactly what Hover emitted before v0.13. Playwright's actionability
 * check still catches a hidden button, but the resulting timeout is:
 *
 *   - Slow: ~10 s in this file (we tightened `actionTimeout` from the
 *     default 30 s; in stock Playwright you'd wait the full 30 s).
 *   - Generic: "TimeoutError: locator.click: Timeout 10000ms exceeded"
 *     reads like a flaky network error.
 *
 * Compare wall-clock + error message to `visibility-prelude.spec.ts`,
 * which under the same drift conditions fails in ~3 s with a clean
 * "Locator expected to be visible" message — the same case, caught
 * better.
 *
 * Tightened to 10 s instead of stock 30 s purely to keep CI snappy.
 * The speed gap is qualitatively identical; the prelude is still 3× as
 * fast as this contrived 10 s ceiling, and ~10× as fast as Playwright's
 * default.
 */

const DRIFT_OFF = '/';
const DRIFT_ON = '/?drift=on';

// Tighten the actionability timeout to keep CI from sitting on this file
// for 30 s × 3 cases = 90 s. The contrast we're demonstrating holds at
// any timeout — the prelude is ~3 s vs whatever ceiling actionability
// hits, including the stock 30 s default.
test.use({ actionTimeout: 10_000 });

test.describe('Pre-v0.13 emit (OLD shape) — drift OFF (baseline)', () => {
  test('Save changes button — direct .click()', async ({ page }) => {
    await page.goto(DRIFT_OFF);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('last-clicked')).toContainText('Save changes');
  });

  test('Apply coupon — direct .click()', async ({ page }) => {
    await page.goto(DRIFT_OFF);
    await page.getByRole('button', { name: 'Apply coupon' }).click();
    await expect(page.getByTestId('last-clicked')).toContainText('Apply coupon');
  });

  test('Subscribe — direct .click()', async ({ page }) => {
    await page.goto(DRIFT_OFF);
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByTestId('last-clicked')).toContainText('Subscribe');
  });
});

test.describe('Pre-v0.13 emit (OLD shape) — drift ON (slow generic timeout)', () => {
  // These tests intentionally FAIL on drift — but their failure is a slow,
  // generic actionability timeout, not the clean "Locator expected to be
  // visible" assertion from the v0.13 emit. Marked .fail() so the suite
  // stays green; CI users can read wall times in the report.

  test.fail('Save changes button — kebab menu (closed <details>)', async ({ page }) => {
    await page.goto(DRIFT_ON);
    // No prelude — straight to .click(). Playwright still auto-waits on
    // actionability (which includes visibility) — it just doesn't tell
    // you that's why it failed until it gives up.
    await page.getByRole('button', { name: 'Save changes' }).click();
  });

  test.fail('Apply coupon — display: none', async ({ page }) => {
    await page.goto(DRIFT_ON);
    await page.getByRole('button', { name: 'Apply coupon' }).click();
  });

  test.fail('Subscribe — visibility: hidden', async ({ page }) => {
    await page.goto(DRIFT_ON);
    await page.getByRole('button', { name: 'Subscribe' }).click();
  });
});
