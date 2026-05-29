import { addVitePlugin, defineNuxtModule } from '@nuxt/kit';
import { launchDebugChrome } from '@hover-dev/core/launch-chrome';
import { startService, type ServiceHandle } from '@hover-dev/core/service';
import type { HoverPluginManifest } from '@hover-dev/core/plugin-api';
import { buildWidgetBundle, manifestsToPluginInputs } from '@hover-dev/widget-bootstrap';
import {
  transformAstro,
  transformJsx,
  transformSvelte,
  transformVue,
} from '@hover-dev/transform-source';

export interface HoverOptions {
  /** Port for the local Hover WebSocket service (default 51789). Auto-bumps
   *  up to 9 times if busy. */
  port?: number;
  /** Whether the module is active. Defaults to `nuxt.options.dev === true`. */
  enabled?: boolean;
  /** Chrome CDP debug port the agent will operate on (default 9222). */
  chromeDebugPort?: number;
  /** Auto-launch a debug Chrome pointed at the dev server when Nuxt starts.
   *  Default false — the widget detects on first click whether it's running
   *  in the debug Chrome and launches one if not. Idempotent: reuses an
   *  existing debug Chrome if `chromeDebugPort` is already alive. */
  autoLaunchChrome?: boolean;
  /** Agent id from @hover-dev/core's registry (default 'claude'). */
  agentId?: string;
  /** Model passed to the agent (default 'sonnet'). */
  model?: string;
  /** Hard $ ceiling per command. No default. */
  maxBudgetUsd?: number;
  /** Optional Hover plugins (e.g. `@hover-dev/security`). Nuxt's module
   *  setup signature doesn't support varargs like vite-plugin-hover, so
   *  plugins go in the options object. Default: no plugins. */
  plugins?: HoverPluginManifest[];
}

/**
 * Hover Nuxt module.
 *
 * Why a module instead of just dropping `vite-plugin-hover` into
 * `nuxt.config.ts`'s `vite.plugins`: Nuxt renders HTML through Nitro, not
 * Vite. Vite's `transformIndexHtml` hook is a no-op for Nuxt SSR/SSG
 * responses (the Nuxt maintainers documented this rejection in nuxt/nuxt
 * #19853). User Vite plugins' `configureServer` still fires, so a hover
 * Vite-plugin would boot the WS service but never inject the widget into
 * the page.
 *
 * Nuxt's blessed mechanism for "ship a script tag on every page" is
 * `nuxt.options.app.head.script`, which Nitro renders into the SSR'd
 * HTML head/body. This module pushes the `@hover-dev/widget-bootstrap`
 * widget bundle there as an inline `bodyClose` script.
 *
 * No-op outside `nuxt dev` (`nuxt build` / `nuxt generate` / `nuxt preview`
 * exit early via the `nuxt.options.dev` check).
 */
export default defineNuxtModule<HoverOptions>({
  meta: {
    name: '@hover-dev/nuxt',
    configKey: 'hover',
  },
  defaults: {},
  async setup(options, nuxt) {
    const requestedPort = options.port ?? 51789;
    const chromeDebugPort = options.chromeDebugPort ?? 9222;
    const autoLaunchChrome = options.autoLaunchChrome ?? false;
    const agentId = options.agentId ?? 'claude';
    const model = options.model ?? 'sonnet';
    const maxBudgetUsd = options.maxBudgetUsd;
    const plugins = options.plugins ?? [];

    const enabled = options.enabled ?? nuxt.options.dev;
    if (!enabled) return;

    // Stamp `data-hover-source` on host elements across every framework
    // shape Vite hosts under Nuxt (Vue SFCs, JSX islands, .svelte/.astro
    // if the user wires those compilers in). `addVitePlugin` registers
    // a sub-plugin into Nuxt's Vite chain — runs in dev only because
    // we early-return above when `nuxt.options.dev` is false.
    addVitePlugin(makeAttributionPlugin(nuxt.options.rootDir));

    let service: ServiceHandle;
    try {
      service = await startService({
        port: requestedPort,
        agentId,
        model,
        maxBudgetUsd,
        cdpUrl: `http://localhost:${chromeDebugPort}`,
        // Nuxt exposes the project root as a filesystem path on
        // `nuxt.options.rootDir` (vs Astro which uses a file:// URL).
        devRoot: nuxt.options.rootDir,
        plugins,
      });
    } catch (err) {
      console.error(
        `[@hover-dev/nuxt] failed to start service: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const bumped = service.port !== requestedPort;
    const pluginNote = plugins.length
      ? ` · plugins=[${plugins.map((p) => p.name).join(', ')}]`
      : '';
    console.info(
      `[@hover-dev/nuxt] service ready · ws://127.0.0.1:${service.port}${bumped ? ` (auto-bumped from ${requestedPort})` : ''} · agent=${agentId} model=${model}${pluginNote}`,
    );

    // Push the widget as an inline script before </body>. We use
    // `bodyClose` so the widget mounts after the user's app DOM is in
    // place. The bundle is the byte-equivalent of what vite-plugin-hover
    // and @hover-dev/astro produce — same @hover-dev/widget-bootstrap
    // middle-layer API.
    const { preamble, body } = buildWidgetBundle({
      port: service.port,
      plugins: manifestsToPluginInputs(plugins),
    });
    nuxt.options.app.head = nuxt.options.app.head ?? {};
    nuxt.options.app.head.script = nuxt.options.app.head.script ?? [];
    nuxt.options.app.head.script.push({
      tagPosition: 'bodyClose',
      type: 'module',
      innerHTML: `${preamble}\n${body}`,
    });

    // Tear down the service on dev-server shutdown.
    nuxt.hook('close', async () => {
      try {
        await service.close();
      } catch (err) {
        console.warn(
          `[@hover-dev/nuxt] error closing service: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    if (!autoLaunchChrome) return;
    // Fire-and-forget Chrome launch. Idempotent — reuses an existing
    // debug Chrome on `chromeDebugPort` if one is alive.
    const devPort = nuxt.options.devServer?.port ?? 3000;
    const url = `http://localhost:${devPort}/`;
    launchDebugChrome({ url, port: chromeDebugPort })
      .then(result => {
        if (!result.ok) {
          console.warn(`[@hover-dev/nuxt] couldn't auto-launch Chrome: ${result.reason}`);
        } else if (result.alreadyRunning) {
          console.info(`[@hover-dev/nuxt] reusing existing debug Chrome on :${result.port}`);
        } else {
          console.info(`[@hover-dev/nuxt] debug Chrome launched on :${result.port}`);
        }
      })
      .catch(err => {
        console.warn(
          `[@hover-dev/nuxt] Chrome auto-launch error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  },
});

/** Tiny Vite plugin: stamps `data-hover-source` on host elements in
 *  every file shape Nuxt's Vite chain hands us. Mirrors the per-extension
 *  dispatch in `vite-plugin-hover` — same logic, separately wired here
 *  because Nuxt's Vite chain is independent of the Vite-plugin shim. */
function makeAttributionPlugin(root: string) {
  return {
    name: 'hover:source-attribution',
    enforce: 'pre' as const,
    apply: 'serve' as const,
    transform(code: string, id: string) {
      const cleanId = id.split('?')[0];
      if (cleanId.includes('/node_modules/')) return null;
      const input = { code, filename: cleanId, root };
      if (/\.(jsx|tsx)$/.test(cleanId)) return transformJsx(input);
      if (cleanId.endsWith('.vue')) return transformVue(input);
      if (cleanId.endsWith('.svelte')) return transformSvelte(input);
      if (cleanId.endsWith('.astro')) return transformAstro(input);
      return null;
    },
  };
}
