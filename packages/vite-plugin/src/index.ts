import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startService, type ServiceHandle } from '@hover/core/service';
import type { Plugin } from 'vite';

export interface HoverOptions {
  /** Port for the local Hover WebSocket service (default 51789). */
  port?: number;
  /** Whether the plugin is active. Defaults to dev mode only. */
  enabled?: boolean | ((env: { mode: string }) => boolean);
  /** Chrome CDP debug port the agent will operate on (default 9222). */
  chromeDebugPort?: number;
  /** Agent id from @hover/core's registry (default 'claude'). */
  agentId?: string;
  /** Model passed to the agent (default 'sonnet'). */
  model?: string;
  /** Hard $ ceiling per command (default 0.5). */
  maxBudgetUsd?: number;
}

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const WIDGET_PATH = resolve(PLUGIN_DIR, 'widget.js');

export function hover(options: HoverOptions = {}): Plugin {
  const port = options.port ?? 51789;
  const agentId = options.agentId ?? 'claude';
  const model = options.model ?? 'sonnet';
  const maxBudgetUsd = options.maxBudgetUsd ?? 0.5;

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
    },

    async closeBundle() {
      if (service) {
        await service.close().catch(() => {});
        service = null;
      }
    },

    transformIndexHtml: {
      order: 'post',
      handler() {
        if (!enabled) return;
        const widgetSource = readFileSync(WIDGET_PATH, 'utf-8');
        // Inject the ACTUAL port the service bound to (not the requested
        // one) so the widget connects to its own example's service even if
        // a sibling Vite already took 51789.
        const preamble = `window.__HOVER_PORT__ = ${servicePort};`;
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: `${preamble}\n${widgetSource}`,
            injectTo: 'body',
          },
        ];
      },
    },
  };
}

export default hover;
