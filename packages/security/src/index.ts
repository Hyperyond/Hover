/**
 * @hover-dev/security — Hover plugin: HTTPS MITM + flow inspector + replay.
 *
 * Usage:
 *
 *   import { hover } from 'vite-plugin-hover';
 *   import securityMode from '@hover-dev/security';
 *
 *   export default defineConfig({
 *     plugins: [hover({}, securityMode())],
 *   });
 *
 * What it contributes (via the @hover-dev/core/plugin-api manifest):
 *   - mode { id: 'security' } shown in the widget mode-picker
 *   - chromeFlags routing the secured Chrome (port 9333, separate profile)
 *     through a local mockttp proxy so HTTPS traffic is decrypted into a
 *     FlowStore that the widget renders as a Network panel
 *   - `hover:mode:activate` hook that boots mockttp and broadcasts
 *     `security:flow:added` / `security:flow:updated` events
 *   - `hover:mode:deactivate` / `hover:service:shutdown` hooks that stop
 *     the proxy cleanly (no orphan listeners across reloads)
 *
 * What it does NOT do yet:
 *   - register an MCP server giving the agent replay/mutate tools — that
 *     lives in a follow-up step.
 *   - emit Playwright spec assertions on the captured flows.
 */
import {
  defineHoverPlugin,
  type HoverPluginManifest,
} from '@hover-dev/core/plugin-api';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProxy, type ProxyHandle } from './mitm/index.js';

export interface SecurityModeOptions {
  /** CDP port for the secured Chrome. Defaults to 9333 (one above normal
   *  Hover's 9222) so both modes can be addressed independently. */
  cdpPort?: number;
  /** User-data-dir for the secured Chrome. Defaults to
   *  `<tmpdir>/hover-chrome-security`. Kept separate from normal mode so
   *  the proxy doesn't see normal-mode cookies. */
  userDataDir?: string;
}

const DEFAULT_CDP_PORT = 9333;
const DEFAULT_USER_DATA_DIR = join(tmpdir(), 'hover-chrome-security');

export default defineHoverPlugin<SecurityModeOptions | void>((opts) => {
  const cdpPort = opts?.cdpPort ?? DEFAULT_CDP_PORT;
  const userDataDir = opts?.userDataDir ?? DEFAULT_USER_DATA_DIR;

  // Closed-over handle so the activate hook can boot the proxy and the
  // deactivate / shutdown hooks can stop it. One factory call ⇒ one
  // handle, because Hover instantiates the manifest once per service.
  let proxy: ProxyHandle | null = null;

  const manifest: HoverPluginManifest = {
    apiVersion: 1,
    name: '@hover-dev/security',

    mode: {
      id: 'security',
      label: 'Security testing',
      description:
        'Routes the debug Chrome through a local HTTPS MITM so the agent can inspect, replay, and mutate API calls.',
    },

    chromeFlags: {
      cdpPort,
      userDataDir,
      // `proxy` is filled in at activate time via setChromeProxy(...).
    },

    systemPromptAdditions: [
      {
        text: [
          'Security testing mode is active. All HTTPS traffic from the',
          'browser is decrypted and visible as "flows" in the widget panel.',
          'When you finish a probe, crystallize findings as Playwright',
          'assertions that re-issue the suspicious request via page.route()',
          'or page.request and assert the expected server status — never',
          'rely on the MITM proxy in the saved spec, since CI does not run it.',
        ].join(' '),
      },
    ],

    widgetEventTypes: ['security:flow:added', 'security:flow:updated'],

    hooks: {
      async 'hover:mode:activate'(ctx) {
        if (proxy) return; // idempotent re-activate
        proxy = await startProxy(ctx.devRoot);
        ctx.setChromeProxy({ port: proxy.port, spki: proxy.ca.spki });

        // Forward FlowStore events to the widget. Use namespaced event
        // type so the widget side can route this to the right panel.
        proxy.store.on('event', (e) => {
          ctx.broadcast({
            type: e.type === 'flow:added' ? 'security:flow:added' : 'security:flow:updated',
            payload: e.flow,
          });
        });
      },

      async 'hover:mode:deactivate'() {
        if (!proxy) return;
        await proxy.stop();
        proxy = null;
      },

      async 'hover:service:shutdown'() {
        if (!proxy) return;
        await proxy.stop();
        proxy = null;
      },
    },
  };

  return manifest;
});

// Also re-export the internals so consumers (and our own MCP server) can
// build on the FlowStore primitives. These are not part of the plugin
// contract — they're a sibling public surface.
export {
  type Flow,
  type FlowRequest,
  type FlowResponse,
  type FlowEvent,
  FlowStore,
  replayFlow,
  type MutateOptions,
} from './mitm/index.js';
