import { test, expect } from '@playwright/test';

/**
 * Plugin host smoke — verifies the widget-bootstrap plugin protocol wires
 * up correctly when `vite-plugin-hover` is invoked with `@hover-dev/security`.
 *
 * What this DOES test (Vite-side, deterministic, no mockttp):
 *   • The widget bundle's preamble injects `window.__HOVER_PLUGINS__` with
 *     security's descriptor (name + modeId + hasWidgetEntry).
 *   • The host API (`window.__HOVER_WIDGET__`) is exposed inside the Shadow
 *     DOM under the widget's <script type="module">.
 *   • Security's widget.js loads and calls registerPlugin successfully — we
 *     check via a side effect: the plugin's CSS-namespacing applier installed
 *     `[data-plugin-active]` infrastructure (one <style data-plugin-style>
 *     per registered plugin once activated; for now we just assert
 *     registration succeeded by inspecting host state).
 *   • Default mode renders the widget panel + mode bar (mode bar visible
 *     because at least one plugin contributed a mode) with NO plugin
 *     contributions visible (no orange tint, no extra header buttons,
 *     record button still visible).
 *
 * What this does NOT test (deferred to manual / @hover-dev/security e2e):
 *   • Actually switching INTO security mode — that boots mockttp + needs
 *     a system-trusted CA, which Playwright can't provide. The plugin
 *     module's contributions activating end-to-end are exercised by
 *     `pnpm --filter @hover-dev/security smoke:e2e`.
 *
 * Selectors run against the Shadow DOM root attached at `#hover-widget-host`.
 */

const SHADOW_HOST = '#hover-widget-host';

test.describe('widget plugin host', () => {
  test('preamble exposes the security plugin descriptor', async ({ page }) => {
    await page.goto('/');

    // `__HOVER_PLUGINS__` is set in the bundle preamble before any client
    // code runs, so it's available synchronously once the page parses the
    // <script>. Poll briefly to let Vite finish injecting the script.
    await expect.poll(
      async () => await page.evaluate(() => (window as unknown as { __HOVER_PLUGINS__?: unknown }).__HOVER_PLUGINS__),
      { timeout: 5000 },
    ).toBeTruthy();

    const plugins = await page.evaluate(() =>
      (window as unknown as { __HOVER_PLUGINS__: unknown[] }).__HOVER_PLUGINS__,
    );

    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '@hover-dev/security',
          modeId: 'security',
          hasWidgetEntry: true,
        }),
      ]),
    );
  });

  test('host API is exposed on window after widget mounts', async ({ page }) => {
    await page.goto('/');

    // The widget mounts a <div id="hover-widget-host"> with a Shadow DOM;
    // host.js runs inside the bundle's <script type="module"> and exposes
    // `window.__HOVER_WIDGET__`. Wait for the host element first, then
    // poll for the global (microtask gap between attach + initHost call).
    await page.locator(SHADOW_HOST).waitFor({ state: 'attached', timeout: 5000 });

    await expect.poll(
      async () =>
        await page.evaluate(
          () =>
            typeof (window as unknown as { __HOVER_WIDGET__?: unknown })
              .__HOVER_WIDGET__,
        ),
      { timeout: 5000 },
    ).toBe('object');

    const apiVersion = await page.evaluate(
      () =>
        (window as unknown as { __HOVER_WIDGET__: { apiVersion: number } })
          .__HOVER_WIDGET__.apiVersion,
    );
    expect(apiVersion).toBe(1);
  });

  test('default mode shows widget without plugin contributions', async ({ page }) => {
    await page.goto('/');
    await page.locator(SHADOW_HOST).waitFor({ state: 'attached' });

    // Reach into the Shadow DOM. Playwright's locator pierces Shadow
    // roots by default, so `.modebar` etc. resolve to the widget's
    // internal elements.
    const widget = page.locator(SHADOW_HOST);

    // Mode bar exists (because security contributes a mode) but isn't
    // engaged (default mode). `.modebar` element is hidden via [hidden]
    // when no plugins, present otherwise — security IS loaded here so it
    // should be visible.
    const modebar = widget.locator('.modebar');
    await expect(modebar).toBeVisible();

    // Label says "Default" — plugin's mode isn't active yet.
    await expect(modebar.locator('.modebar-label')).toHaveText('Default');
    await expect(modebar).not.toHaveClass(/engaged/);

    // No plugin overlays in the DOM (they're appended on activate, removed
    // on deactivate; we're in default mode).
    await expect(widget.locator('.plugin-overlay')).toHaveCount(0);

    // No plugin toolbar buttons in the header.
    await expect(widget.locator('.plugin-toolbar-btn')).toHaveCount(0);

    // The .panel root does NOT carry data-plugin-active — that attribute
    // is only set while a plugin's mode is the active one.
    await expect(widget.locator('.panel')).not.toHaveAttribute(
      'data-plugin-active',
      /.+/,
    );

    // Record button — the legacy hardcoded `recordBtn.hidden = engaged`
    // path is gone; security's plugin module now does this declaratively
    // via spec.domMutations. In default mode (security inactive), record
    // remains visible.
    await expect(widget.locator('.record-btn')).toBeVisible();
  });
});
