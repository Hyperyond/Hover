#!/usr/bin/env node
/**
 * `hover-chrome` bin re-exposed from vite-plugin-hover so npm consumers
 * who only install the plugin can run `pnpm exec hover-chrome` / `npx
 * hover-chrome` without also adding @hover-dev/core to their dependencies.
 *
 * pnpm doesn't symlink transitive-dependency bins into node_modules/.bin/, so
 * the bin has to live on the user's direct dependency. Implementation lives
 * in @hover-dev/core/launch-chrome.
 */
import { launchDebugChrome } from '@hover-dev/core/launch-chrome';

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
