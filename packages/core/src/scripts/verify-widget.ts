/**
 * Programmatic verification that @hover/vite-plugin actually injects a working
 * widget into the user's dev page. Run after `pnpm dev:example`:
 *
 *     pnpm --filter @hover/core verify-widget
 *
 * Loads http://localhost:5173/ in the user's Chrome (via CDP), then asserts
 * the Shadow-DOM widget exists and opens on click.
 */
import { chromium } from 'playwright-core';

const CDP_URL = process.env.HOVER_CDP ?? 'http://localhost:9222';
const TARGET = process.argv[2] ?? 'http://localhost:5173/';

const browser = await chromium.connectOverCDP(CDP_URL);
const contexts = browser.contexts();
const existing = contexts
  .flatMap(c => c.pages())
  .find(p => p.url().startsWith(TARGET));

const page = existing ?? (await contexts[0]!.newPage());
if (!existing) {
  await page.goto(TARGET, { waitUntil: 'load' });
}

// Clear any persisted widget state (open flag, messages, sessionId) so the
// "initial" assertions below test a fresh widget, not a session in progress.
await page.evaluate(() => {
  try { localStorage.removeItem('hover:state:v1'); } catch {}
});
await page.reload({ waitUntil: 'load' });

await page.waitForSelector('#hover-widget-host', { timeout: 3000, state: 'attached' });

const initial = await page.evaluate(() => {
  const host = document.getElementById('hover-widget-host');
  if (!host) return { ok: false, reason: 'host element missing' };
  const shadow = host.shadowRoot;
  if (!shadow) return { ok: false, reason: 'shadow root missing (mode: open required)' };
  const launcher = shadow.querySelector('.launcher');
  const panel = shadow.querySelector('.panel');
  if (!launcher) return { ok: false, reason: '.launcher missing in shadow tree' };
  if (!panel) return { ok: false, reason: '.panel missing in shadow tree' };
  return {
    ok: true,
    dataHover: host.dataset.hover,
    panelOpenInitially: panel.classList.contains('open'),
    launcherText: launcher.textContent?.trim().length ?? 0,
  };
});

if (!initial.ok) {
  console.error(`✗ Widget structure invalid: ${initial.reason}`);
  await browser.close();
  process.exit(1);
}

console.log(`✓ Widget host found, data-hover="${initial.dataHover}"`);
console.log(`✓ Shadow DOM constructed with .launcher and .panel`);
if (initial.panelOpenInitially) {
  console.error('✗ Panel is open initially — expected closed');
  await browser.close();
  process.exit(1);
}
console.log('✓ Panel is closed initially');

await page.evaluate(() => {
  const host = document.getElementById('hover-widget-host')!;
  (host.shadowRoot!.querySelector('.launcher') as HTMLButtonElement).click();
});

await page.waitForFunction(
  () => {
    const host = document.getElementById('hover-widget-host');
    return host?.shadowRoot?.querySelector('.panel')?.classList.contains('open') ?? false;
  },
  { timeout: 1000 },
);
console.log('✓ Panel opens on launcher click');

await page.evaluate(() => {
  const host = document.getElementById('hover-widget-host')!;
  (host.shadowRoot!.querySelector('.launcher') as HTMLButtonElement).click();
});

await page.waitForFunction(
  () => {
    const host = document.getElementById('hover-widget-host');
    return !(host?.shadowRoot?.querySelector('.panel')?.classList.contains('open') ?? false);
  },
  { timeout: 1000 },
);
console.log('✓ Panel closes on second click');

console.log('\nAll widget assertions passed.');
await browser.close();
