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

  return {
    name: 'hover',
    apply: 'serve',

    configResolved(config) {
      enabled =
        typeof options.enabled === 'function'
          ? options.enabled({ mode: config.mode })
          : options.enabled ?? config.mode === 'development';
    },

    configureServer(server) {
      if (!enabled) return;
      try {
        service = startService({ port, agentId, model, maxBudgetUsd });
        server.config.logger.info(
          `[hover] service ready · ws://127.0.0.1:${port} · agent=${agentId} model=${model}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        server.config.logger.error(`[hover] failed to start service on port ${port}: ${msg}`);
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
        // Inject HOVER_PORT before the widget source so the IIFE can read it.
        const preamble = `window.__HOVER_PORT__ = ${port};`;
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
