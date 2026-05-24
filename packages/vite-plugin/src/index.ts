import { launchDebugChrome } from '@hover-dev/core/launch-chrome';
import { startService, type ServiceHandle } from '@hover-dev/core/service';
import { getWidgetScript } from '@hover-dev/widget-bootstrap';
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
}

export function hover(options: HoverOptions = {}): Plugin {
  const port = options.port ?? 51789;
  const chromeDebugPort = options.chromeDebugPort ?? 9222;
  const autoLaunchChrome = options.autoLaunchChrome ?? false;
  const agentId = options.agentId ?? 'claude';
  const model = options.model ?? 'sonnet';
  // No default cap — real flows (form filling, multi-step checkouts) used
  // to die mid-run at the old $0.50 ceiling. The widget shows the running $
  // counter in its header so the user can Stop when they've seen enough.
  // Pass an explicit number here to reinstate a hard ceiling.
  const maxBudgetUsd = options.maxBudgetUsd;

  let enabled = true;
  let service: ServiceHandle | null = null;
  let servicePort = port;

  return {
    name: 'hover',
    apply: 'serve',

    configResolved(config) {
      enabled =
        typeof options.enabled === 'function'
          ? options.enabled({ mode: config.mode })
          : options.enabled ?? config.mode === 'development';
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
        });
        servicePort = service.port;
        const bumped = servicePort !== port;
        server.config.logger.info(
          `[hover] service ready · ws://127.0.0.1:${servicePort}${bumped ? ` (auto-bumped from ${port})` : ''} · agent=${agentId} model=${model} · root=${server.config.root}`,
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
        return [getWidgetScript({ port: () => servicePort })];
      },
    },
  };
}

export default hover;
