#!/usr/bin/env node
/**
 * "Start debug Chrome on port 9222" CLI.
 *
 * Two entry points:
 *   - Repo dev:    `pnpm smoke:chrome`           → tsx src/scripts/start-chrome.ts
 *   - npm consumer: `pnpm exec hover-chrome`     → dist/scripts/start-chrome.js
 *                  (or `npx hover-chrome`, bin exposed by vite-plugin-hover)
 *
 * All actual launch logic lives in ../playwright/launchChrome.ts.
 */
import { launchDebugChrome } from '../playwright/launchChrome.js';

const result = await launchDebugChrome();
if (!result.ok) {
  console.error(`[hover:chrome] ${result.reason}`);
  process.exit(1);
}
if (result.alreadyRunning) {
  console.log(`[hover:chrome] already listening on ${result.port}`);
} else {
  console.log(`[hover:chrome] ready on ${result.port} (data-dir=${result.userDataDir})`);
}
