import { test, expect } from '@playwright/test';

/**
 * Dogfood spec — the exact shape Hover emits when a user clicks "Save as
 * Playwright spec" on the example frontend's login + counter flow.
 *
 * Original prompt: log in then click + 1 three times and verify the counter, then add a todo and verify it
 * Outcome: Logged in, counter is 03, todo "verify hover" added.
 *
 * Steps:
 *   1. Open /
 *   2. Type "claude@sparkplay.io" into Email
 *   3. Type "demo1234" into Password
 *   4. Click Submit button
 *   5. Click + 1 button (× 3)
 *   6. Type "verify hover" into new todo
 *   7. Click Add button
 *   8. Click remove verify hover button
 *
 * Expected:
 *   • welcome heading shows the logged-in email
 *   • counter reads 03
 *   • todo "verify hover" appears in the list, then is removed
 *
 * Selectors prefer getByRole / getByLabel / getByTestId over CSS/XPath, so
 * the saved spec survives layout/markup changes that don't touch semantics.
 */
test.describe('basic-app / login + counter', () => {
  test('logs in and increments the counter to 3', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Email').fill('claude@sparkplay.io');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(page.getByTestId('welcome')).toHaveText('claude@sparkplay.io');

    const plusOne = page.getByRole('button', { name: '+ 1' });
    await plusOne.click();
    await plusOne.click();
    await plusOne.click();

    await expect(page.getByTestId('count')).toHaveText('03');
  });

  test('adds and removes a todo', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('new todo').fill('verify hover');
    await page.getByRole('button', { name: 'Add' }).click();

    const list = page.getByTestId('todo-list');
    await expect(list.getByText('verify hover')).toBeVisible();

    await list.getByRole('button', { name: 'remove verify hover' }).click();
    await expect(list.getByText('verify hover')).toHaveCount(0);
  });
});
