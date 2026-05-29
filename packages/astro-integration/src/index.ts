import { readFile as fsReadFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchDebugChrome } from '@hover-dev/core/launch-chrome';
import { startService, type ServiceHandle } from '@hover-dev/core/service';
import { buildWidgetBundle } from '@hover-dev/widget-bootstrap';
import {
  transformAstro,
  transformJsx,
  transformSvelte,
  transformVue,
} from '@hover-dev/transform-source';
import type { AstroIntegration } from 'astro';

export interface HoverOptions {
  /** Port for the local Hover WebSocket service (default 51789). Auto-bumps
   *  up to 9 times if busy. */
  port?: number;
  /** Whether the integration is active. Defaults to `command === 'dev'`. */
  enabled?: boolean | ((env: { command: string }) => boolean);
  /** Chrome CDP debug port the agent will operate on (default 9222). */
  chromeDebugPort?: number;
  /** Auto-launch a debug Chrome pointed at the dev server when Astro starts.
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
}

/**
 * Hover Astro integration.
 *
 * Why a separate integration instead of just using `vite-plugin-hover` via
 * `astro.config.mjs`'s `vite.plugins`: Astro's HTML pipeline for `.astro`
 * pages bypasses user-registered Vite plugins' `transformIndexHtml` output
 * (verified empirically — the WS service boots fine via `configureServer`,
 * but the widget `<script>` tag is dropped from the rendered HTML). Astro's
 * canonical extension point for "add a script to every page" is the
 * integration API's `injectScript('page', ...)`, which is what we use here.
 *
 * No-op outside `astro dev` — `astro build` / `preview` / `sync` exit early.
 */
export function hover(options: HoverOptions = {}): AstroIntegration {
  const requestedPort = options.port ?? 51789;
  const chromeDebugPort = options.chromeDebugPort ?? 9222;
  const autoLaunchChrome = options.autoLaunchChrome ?? false;
  const agentId = options.agentId ?? 'claude';
  const model = options.model ?? 'sonnet';
  const maxBudgetUsd = options.maxBudgetUsd;

  let service: ServiceHandle | null = null;

  return {
    name: '@hover-dev/astro',
    hooks: {
      'astro:config:setup': async ({ command, config, injectScript, updateConfig, logger }) => {
        const enabled =
          typeof options.enabled === 'function'
            ? options.enabled({ command })
            : options.enabled ?? command === 'dev';
        if (!enabled) return;

        // Source-attribution Vite sub-plugin. Astro runs Vite under the
        // hood for `.jsx`/`.tsx`/`.vue`/`.svelte` + handles `.astro`
        // through its own compiler internally — but `.astro` files
        // also pass through Vite's `transform` hook before Astro's
        // compiler runs, so a single Vite plugin can stamp host
        // elements across every file shape Astro hosts.
        const projectRoot = fileURLToPath(config.root);
        updateConfig({
          vite: {
            plugins: [makeAttributionPlugin(projectRoot)],
          },
        });

        try {
          service = await startService({
            port: requestedPort,
            agentId,
            model,
            maxBudgetUsd,
            cdpUrl: `http://localhost:${chromeDebugPort}`,
            // Project root for skill saves. Astro exposes this via
            // `config.root` which is a URL — convert to filesystem path.
            devRoot: fileURLToPath(config.root),
          });
        } catch (err) {
          logger.error(
            `failed to start service: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }

        const bumped = service.port !== requestedPort;
        logger.info(
          `service ready · ws://127.0.0.1:${service.port}${bumped ? ` (auto-bumped from ${requestedPort})` : ''} · agent=${agentId} model=${model}`,
        );

        // Inject the widget bundle on every page. Unlike vite-plugin-hover's
        // transformIndexHtml path, this is a single resolved string — by
        // the time we call injectScript the service has bound and we know
        // the actual port. No thunk needed here.
        const { preamble, body } = buildWidgetBundle({ port: service.port });
        injectScript('page', `${preamble}\n${body}`);

        if (!autoLaunchChrome) return;
        // Fire-and-forget Chrome launch. Idempotent: reuses an existing
        // debug Chrome if one is already on `chromeDebugPort`.
        const url = `http://localhost:${guessAstroPort(config)}/`;
        launchDebugChrome({ url, port: chromeDebugPort })
          .then(result => {
            if (!result.ok) {
              logger.warn(`couldn't auto-launch Chrome: ${result.reason}`);
            } else if (result.alreadyRunning) {
              logger.info(`reusing existing debug Chrome on :${result.port}`);
            } else {
              logger.info(`debug Chrome launched on :${result.port}`);
            }
          })
          .catch(err => {
            logger.warn(`Chrome auto-launch error: ${err instanceof Error ? err.message : String(err)}`);
          });
      },
      'astro:server:setup': async ({ server, logger }) => {
        // Astro's own `astro:build` Vite plugin registers itself with
        // `enforce: 'pre'` and runs the `.astro` compiler in its
        // `transform()` — turning raw `.astro` source into JavaScript.
        // Any user-registered `enforce: 'pre'` plugin (us, via
        // updateConfig above) ends up AFTER it in the chain, so by the
        // time our transform runs the file is already JS and we have
        // no `.astro` source to stamp. (Tracked: withastro/roadmap#120.)
        //
        // Workaround: at `astro:server:setup` we have direct access to
        // the Vite server's resolved plugin list. Splice our plugin
        // out of wherever it landed and put it at index 0 so it sees
        // the raw `.astro` source first. This is unsupported and may
        // break on internal Astro refactors; we tolerate that for now
        // and document the version coverage in CLAUDE.md.
        const plugins = server.config.plugins as unknown as Array<{ name?: string }>;
        const idx = plugins.findIndex((p) => p?.name === 'hover:source-attribution');
        if (idx > 0) {
          const [ours] = plugins.splice(idx, 1);
          plugins.unshift(ours);
          logger.info('source-attribution plugin moved to position 0 (pre-Astro compile)');
        } else if (idx === -1) {
          logger.warn('source-attribution plugin not found in Vite chain — .astro stamps will be no-op');
        }
      },
      'astro:server:done': async ({ logger }) => {
        if (!service) return;
        try {
          await service.close();
        } catch (err) {
          logger.warn(`error closing service: ${err instanceof Error ? err.message : String(err)}`);
        }
        service = null;
      },
    },
  };
}

export default hover;

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Best-effort Astro dev URL for the auto-Chrome-launch. Astro stores port
 * config under `config.server.port` (default 4321). We use this only to
 * point Chrome at the right URL; if it's wrong the user can navigate
 * themselves and the widget still works once the page loads.
 */
function guessAstroPort(config: { server?: { port?: number } }): number {
  return config.server?.port ?? 4321;
}

/** Tiny Vite plugin: stamps `data-hover-source` on host elements in
 *  every file shape the Astro pipeline hands to Vite. Mirrors the
 *  per-extension dispatch used by `vite-plugin-hover` — same input
 *  shape, same outputs, same `enforce: 'pre'` requirement so the
 *  patch lands before framework compilers (React / Vue / Svelte / Astro)
 *  collapse the JSX/template AST. */
function makeAttributionPlugin(root: string) {
  return {
    name: 'hover:source-attribution',
    enforce: 'pre' as const,
    apply: 'serve' as const,
    // `load` hook: Astro's `astro:build` plugin loads `.astro` files via
    // its own `load(id)` which reads the source from disk and compiles
    // it to JS in one step — so by the time `transform()` runs, the
    // `code` argument is already JS. To stamp host elements in the
    // *original* `.astro` source we have to intercept at `load`: read
    // the raw file ourselves, transform, and return the modified
    // source. Astro's `load` then sees our stamped output and compiles
    // it normally.
    //
    // Only handles `.astro` here; other extensions still go through
    // `transform` below where the standard Vite contract applies.
    async load(id: string) {
      const cleanId = id.split('?')[0];
      if (cleanId.includes('/node_modules/')) return null;
      if (!cleanId.endsWith('.astro')) return null;
      let code: string;
      try {
        code = await fsReadFile(cleanId, 'utf8');
      } catch {
        return null;
      }
      const out = await transformAstro({ code, filename: cleanId, root });
      if (!out) return code; // Return raw source so Astro's load doesn't re-read.
      return { code: out.code, map: out.map as unknown as null };
    },
    transform(code: string, id: string) {
      const cleanId = id.split('?')[0];
      if (cleanId.includes('/node_modules/')) return null;
      // .astro handled by `load` above. Others go through transform.
      if (cleanId.endsWith('.astro')) return null;
      const input = { code, filename: cleanId, root };
      if (/\.(jsx|tsx)$/.test(cleanId)) return transformJsx(input);
      if (cleanId.endsWith('.vue')) return transformVue(input);
      if (cleanId.endsWith('.svelte')) return transformSvelte(input);
      return null;
    },
  };
}
