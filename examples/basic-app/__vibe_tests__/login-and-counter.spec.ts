import { test, expect } from '@playwright/test';

/**
 * Dogfood spec — the exact shape Hover emits when a user clicks "save as
 * Playwright spec" on the example frontend's login + counter flow.
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
