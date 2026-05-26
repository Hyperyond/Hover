/**
 * End-to-end smoke for security-mode Chrome launch.
 *
 * Boots mockttp + launches an ISOLATED debug Chrome (CDP port 9333, separate
 * profile so it doesn't conflict with a normal-mode :9222 if present) with
 * --proxy-server + SPKI pin, connects Playwright via CDP, navigates to a
 * real HTTPS site, and asserts mockttp saw a decrypted h2 request for it.
 *
 * Cleans up Chrome + proxy on exit.
 */
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startProxy } from '../mitm/index.js';
import { launchDebugChrome } from '../playwright/launchChrome.js';
import { spawnSync } from 'node:child_process';

const SEC_CDP_PORT = 9333;
const TARGET = 'https://example.com/';

const devRoot = mkdtempSync(join(tmpdir(), 'hover-mitm-e2e-'));
console.log('[e2e] devRoot =', devRoot);

const proxy = await startProxy(devRoot);
console.log(`[e2e] proxy :${proxy.port}  SPKI=${proxy.ca.spki}`);

const profileDir = mkdtempSync(join(tmpdir(), 'hover-sec-chrome-'));
const launch = await launchDebugChrome({
  port: SEC_CDP_PORT,
  userDataDir: profileDir,
  url: 'about:blank',
  proxy: { port: proxy.port, spki: proxy.ca.spki },
});

if (!launch.ok) {
  console.log('[e2e] FAIL Chrome launch:', launch.reason);
  await proxy.stop();
  process.exit(1);
}
console.log(`[e2e] Chrome up on CDP :${SEC_CDP_PORT}  profile=${profileDir}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${SEC_CDP_PORT}`);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());

const t0 = Date.now();
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 15000 });
console.log(`[e2e] page.goto ${TARGET} in ${Date.now() - t0}ms`);
const title = await page.title();
console.log(`[e2e] title="${title}"`);

await browser.close();

// Give the response callback time to settle
await new Promise((r) => setTimeout(r, 200));

const flows = proxy.store.list();
const exampleFlow = flows.find((f) => f.request.url === TARGET);

const pass =
  !!exampleFlow &&
  exampleFlow.request.httpVersion === '2.0' &&
  exampleFlow.response?.statusCode === 200;

console.log('\n=== STEP 2 E2E VERDICT ===');
console.log(`Chrome via SPKI pin (no cert error):  ${title ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`mockttp saw the example.com request:  ${exampleFlow ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`HTTP/2 negotiation:                   ${exampleFlow?.request.httpVersion === '2.0' ? 'PASS ✅' : 'FAIL ❌ (got ' + exampleFlow?.request.httpVersion + ')'}`);
console.log(`Total flows captured:                 ${flows.length}`);
console.log('==========================\n');

// Kill the detached Chrome process
spawnSync('pkill', ['-f', profileDir]);

await proxy.stop();
process.exit(pass ? 0 : 1);
