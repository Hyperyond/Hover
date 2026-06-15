/**
 * Translation seeds: human-written worked examples that teach the optimization
 * pass (F7) a multi-step Playwright pattern by few-shot — NOT by deterministic
 * match+template. A seed is a rough `signature` (tool names, used only to pick
 * relevant seeds) + a concrete `example` (input steps → output code) the LLM
 * generalizes from.
 *
 * These ship inlined as the `BUILTIN_SEEDS` constant below. They used to be
 * JSON files under `packages/core/seeds/optimization/` plus a `.hover/rules/`
 * "author your own seed" mechanism and a `.hover/seeds.json` opt-out — all
 * removed: that user-facing surface added burden for a small curated catalogue
 * that feeds an optional, manually-invoked pass. To add a pattern, append a
 * `SeedRule` here.
 */

export interface SeedRule {
  /** Identifier, e.g. `download`. */
  name: string;
  /** Rough match signature — tool names (optionally `tool:detail`), used only
   *  to pick relevant seeds for a spec, NOT for exact matching. */
  signature: string[];
  /** One-line human note: what the pattern is / when it applies. */
  note?: string;
  /** A concrete worked example the LLM generalizes from. */
  example: { steps: unknown[]; code: string };
}

/**
 * Built-in optimization seeds, inlined. They feed EVERY project's optimization
 * pass (the prompt builder and the relevance filter consume this directly).
 */
export const BUILTIN_SEEDS: SeedRule[] = [
  {
    name: 'download',
    signature: ['browser_click'],
    note: 'A click that triggers a file download — pair it with waitForEvent(\'download\') so the listener is registered before the click fires.',
    example: {
      steps: [{ tool: 'browser_click', element: 'Export CSV button' }],
      code: `const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Export CSV' }).click(),
]);
expect(await download.suggestedFilename()).toContain('.csv');`,
    },
  },
  {
    name: 'file-upload',
    signature: ['browser_file_upload'],
    note: 'Set a file on a (often hidden) <input type=file>. The file chooser opens synchronously on click, so register waitForEvent(\'filechooser\') before the click — same race as download.',
    example: {
      steps: [
        { tool: 'browser_click', element: 'Upload avatar button' },
        { tool: 'browser_file_upload', paths: ['avatar.png'] },
      ],
      code: `const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByRole('button', { name: 'Upload avatar' }).click(),
]);
await chooser.setFiles('tests/fixtures/avatar.png');
await expect(page.getByText('avatar.png')).toBeVisible();`,
    },
  },
  {
    name: 'dialog',
    signature: ['browser_handle_dialog'],
    note: 'A click that triggers a native dialog (alert/confirm/prompt). Register the page \'dialog\' handler BEFORE the click that fires it — otherwise Playwright auto-dismisses it and the assertion is wrong.',
    example: {
      steps: [
        { tool: 'browser_click', element: 'Delete account button' },
        { tool: 'browser_handle_dialog', action: 'accept' },
      ],
      code: `page.once('dialog', dialog => dialog.accept());
await page.getByRole('button', { name: 'Delete account' }).click();
await expect(page.getByText('Account deleted')).toBeVisible();`,
    },
  },
  {
    name: 'oauth-popup',
    signature: ['browser_click', 'browser_tabs:select'],
    note: 'Sign in through a provider popup that opens a new tab. Pair the opener click with context.waitForEvent(\'page\'), then drive the returned popup page.',
    example: {
      steps: [
        { tool: 'browser_click', element: 'Sign in with Google button' },
        { tool: 'browser_tabs', action: 'select', idx: 1 },
      ],
      code: `const [popup] = await Promise.all([
  context.waitForEvent('page'),
  page.getByRole('button', { name: 'Sign in with Google' }).click(),
]);
await popup.getByLabel('Email').fill('user@example.com');
await popup.getByRole('button', { name: 'Next' }).click();
await popup.waitForEvent('close');
await expect(page.getByText('Signed in')).toBeVisible();`,
    },
  },
  {
    name: 'network-gated-assertion',
    signature: ['browser_click', 'browser_wait_for'],
    note: 'A click fires an XHR/fetch and the result is asserted. Pair the click with page.waitForResponse so the test waits for the real request to settle, instead of a guessed timeout or a race.',
    example: {
      steps: [
        { tool: 'browser_click', element: 'Place order button' },
        { tool: 'browser_wait_for', text: 'Order confirmed' },
      ],
      code: `const [res] = await Promise.all([
  page.waitForResponse(r => r.url().includes('/api/orders') && r.request().method() === 'POST'),
  page.getByRole('button', { name: 'Place order' }).click(),
]);
expect(res.ok()).toBeTruthy();
await expect(page.getByText('Order confirmed')).toBeVisible();`,
    },
  },
];

/** Pick seeds whose signature's base tool appears in the spec — a cheap
 *  relevance filter so the prompt only carries plausibly-applicable examples. */
export function relevantSeeds(seeds: SeedRule[], specTools: Set<string>, cap = 6): SeedRule[] {
  const hits = seeds.filter(s => s.signature.some(sig => specTools.has(sig.split(':')[0])));
  return hits.slice(0, cap);
}
