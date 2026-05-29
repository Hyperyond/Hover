import { launchDebugChrome } from '@hover-dev/core/launch-chrome';
import { startService, type ServiceHandle } from '@hover-dev/core/service';
import type { HoverPluginManifest } from '@hover-dev/core/plugin-api';
import { getWidgetScript, manifestsToPluginInputs } from '@hover-dev/widget-bootstrap';
import { transformJsx, transformVue, transformSvelte, transformAstro } from '@hover-dev/transform-source';
import type { Plugin } from 'vite';

export interface HoverOptions {
  /** Port for the local Hover WebSocket service (default 51789). */
  port?: number;
  /** Whether the plugin is active. Defaults to dev mode only. */
  enabled?: boolean | ((env: { mode: string }) => boolean);
  /** Chrome CDP debug port the agent will operate on (default 9222). */
  chromeDebugPort?: number;
  /** Auto-launch a debug Chrome pointed at the dev server when Vite starts.
   *  Default false: the widget detects on first click whether it's running in
   *  the debug Chrome and launches one if not, which is less disruptive than
   *  popping a window on every `pnpm dev`. Set true to pre-warm Chrome at
   *  startup (matches the old behaviour). Idempotent — reuses an existing
   *  debug Chrome if `chromeDebugPort` is already alive. */
  autoLaunchChrome?: boolean;
  /** Agent id from @hover-dev/core's registry (default 'claude'). */
  agentId?: string;
  /** Model passed to the agent (default 'sonnet'). */
  model?: string;
  /** Hard $ ceiling per command. No default — flows can run as long as the
   *  user lets them; the widget's running-cost chip + Stop button are the
   *  intended control. Set a number here if you want a hard cutoff. */
  maxBudgetUsd?: number;
  /** Stamp `data-hover-source="<file>:<line>:<col>"` on host JSX elements in
   *  user code so the widget's element picker can produce a precise file
   *  location. Dev-only; serve-mode plugin is a no-op in production anyway.
   *  Default true. Set false to disable if it conflicts with another tool. */
  sourceAttribution?: boolean;
}

export function hover(options?: HoverOptions, ...plugins: HoverPluginManifest[]): Plugin {
  const opts = options ?? {};
  const port = opts.port ?? 51789;
  const chromeDebugPort = opts.chromeDebugPort ?? 9222;
  const autoLaunchChrome = opts.autoLaunchChrome ?? false;
  const agentId = opts.agentId ?? 'claude';
  const model = opts.model ?? 'sonnet';
  // No default cap — real flows (form filling, multi-step checkouts) used
  // to die mid-run at the old $0.50 ceiling. The widget shows the running $
  // counter in its header so the user can Stop when they've seen enough.
  // Pass an explicit number here to reinstate a hard ceiling.
  const maxBudgetUsd = opts.maxBudgetUsd;
  const sourceAttribution = opts.sourceAttribution ?? true;

  let enabled = true;
  let service: ServiceHandle | null = null;
  let servicePort = port;
  let viteRoot = process.cwd();

  return {
    name: 'hover',
    apply: 'serve',
    // Must run before @vitejs/plugin-react / vue / svelte transforms — those
    // collapse JSX/templates into render-function calls, leaving no host-tag
    // AST for source-attribution to walk. `enforce: 'pre'` puts us at the
    // top of the user-plugin chain.
    enforce: 'pre',

    configResolved(config) {
      enabled =
        typeof opts.enabled === 'function'
          ? opts.enabled({ mode: config.mode })
          : opts.enabled ?? config.mode === 'development';
      viteRoot = config.root;
    },

    transform(code, id) {
      if (!enabled || !sourceAttribution) return null;
      // Strip Vite's `?query` / `#hash` suffixes before extension check.
      // `.vue` ships through Vite as `App.vue?vue&type=template&...` for
      // sub-blocks once @vitejs/plugin-vue rewrites them; we only want
      // the top-level SFC pass, so the query-strip + extension check
      // is enough to filter out the sub-block requests.
      const cleanId = id.split('?')[0];
      if (cleanId.includes('/node_modules/')) return null;
      const input = { code, filename: cleanId, root: viteRoot };
      if (/\.(jsx|tsx)$/.test(cleanId)) return transformJsx(input);
      if (cleanId.endsWith('.vue')) return transformVue(input);
      if (cleanId.endsWith('.svelte')) return transformSvelte(input);
      if (cleanId.endsWith('.astro')) return transformAstro(input);
      return null;
    },

    async configureServer(server) {
      if (!enabled) return;
      try {
        service = await startService({
          port,
          agentId,
          model,
          maxBudgetUsd,
          cdpUrl: `http://localhost:${chromeDebugPort}`,
          // The Vite project root is where the agent runs (cwd) and where
          // `Save as Skill` writes `.claude/skills/<slug>/SKILL.md`.
          devRoot: server.config.root,
          plugins,
        });
        servicePort = service.port;
        const bumped = servicePort !== port;
        const pluginNote = plugins.length
          ? ` · plugins=[${plugins.map((p) => p.name).join(', ')}]`
          : '';
        server.config.logger.info(
          `[hover] service ready · ws://127.0.0.1:${servicePort}${bumped ? ` (auto-bumped from ${port})` : ''} · agent=${agentId} model=${model}${pluginNote} · root=${server.config.root}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        server.config.logger.error(`[hover] failed to start service: ${msg}`);
      }

      // Once Vite is listening, fire-and-forget a debug Chrome on
      // chromeDebugPort, pointed at the dev URL. If a debug Chrome is already
      // there (port 9222 alive) launchDebugChrome short-circuits — so this is
      // idempotent across HMR restarts and across multiple concurrent example
      // apps. The user gets a working browser without an extra command.
      if (!autoLaunchChrome) return;
      const launch = () => {
        const url = server.resolvedUrls?.local[0] ?? `http://localhost:${server.config.server.port ?? 5173}/`;
        launchDebugChrome({ url, port: chromeDebugPort })
          .then(result => {
            if (!result.ok) {
              server.config.logger.warn(
                `[hover] couldn't auto-launch Chrome: ${result.reason}. Open ${url} in a Chrome started with --remote-debugging-port=${chromeDebugPort}, or run \`pnpm exec hover-chrome\`.`,
              );
            } else if (result.alreadyRunning) {
              server.config.logger.info(`[hover] reusing existing debug Chrome on :${result.port}`);
            } else {
              server.config.logger.info(
                `[hover] debug Chrome launched on :${result.port} (data-dir=${result.userDataDir})`,
              );
            }
          })
          .catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            server.config.logger.warn(`[hover] Chrome auto-launch error: ${msg}`);
          });
      };
      if (server.httpServer) {
        server.httpServer.once('listening', launch);
      } else {
        // middleware mode — no httpServer; URL is best-effort
        launch();
      }
    },

    async closeBundle() {
      if (service) {
        try {
          await service.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // No access to the logger here (closeBundle has no server arg);
          // stderr is the next-best place so the failure isn't invisible.
          console.warn(`[hover] error closing service: ${msg}`);
        }
        service = null;
      }
    },

    transformIndexHtml: {
      order: 'post',
      handler() {
        if (!enabled) return;
        // Widget assembly (file reads, mtime cache, preamble, regex strips)
        // all live in @hover-dev/widget-bootstrap so a future
        // webpack-plugin-hover / next-plugin-hover can produce a
        // byte-identical bundle from a different host. We pass `servicePort`
        // as a thunk because the actual bound port is only known after
        // `configureServer` ran (auto-bump from 51789 if busy).
        return [getWidgetScript({
          port: () => servicePort,
          plugins: manifestsToPluginInputs(plugins),
        })];
      },
    },
  };
}

export default hover;
