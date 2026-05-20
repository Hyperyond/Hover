import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the dogfood e2e suite.
 *
 * The specs in `__vibe_tests__/` are the exact shape Hover emits when the user
 * clicks "save as Playwright spec" — standard `@playwright/test`, no agent in
 * the loop, no Hover runtime dependency. They run in CI with just chromium.
 *
 * To bootstrap on a fresh machine:
 *   pnpm install
 *   pnpm --filter example-frontend exec playwright install chromium
 *   pnpm --filter example-frontend test
 */
export default defineConfig({
  testDir: './__vibe_tests__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
