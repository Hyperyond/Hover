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
 *   - mcpServers exposing list_flows / get_flow / replay_flow /
 *     clear_flows to the agent (see src/mcp/server.ts)
 *   - systemPromptAdditions teaching the agent the security workflow,
 *     scope (authz / frontend / compliance), and explicit forbidden
 *     attack classes (SQLi / SSRF / RCE / fuzzing loops)
 *   - `hover:mode:activate` hook that boots mockttp + the control plane
 *     and broadcasts `security:flow:added` / `security:flow:updated`
 *   - `hover:mode:deactivate` / `hover:service:shutdown` hooks that stop
 *     the proxy + control plane cleanly (no orphan listeners or sockets
 *     across reloads)
 */
import {
  defineHoverPlugin,
  type HoverPluginManifest,
} from '@hover-dev/core/plugin-api';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy, type ProxyHandle } from './mitm/index.js';
import { startControlPlane, type ControlPlaneHandle } from './control-plane.js';

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
const MCP_SERVER_ID = '@hover-dev/security:flows';

/**
 * System-prompt addition concatenated onto the agent's prompt when
 * security mode is active. Scope-restricted to browser-reachable
 * issues — we explicitly tell the agent NOT to attempt server-side
 * vulnerability classes (SQLi / SSRF / RCE) that this framework can't
 * meaningfully probe.
 */
const SECURITY_SYSTEM_PROMPT = `Security testing mode is active. This is AUTHORISED testing on the user's
own dev application. Your job is to probe for vulnerabilities reachable
from a browser session, then crystallize findings into Playwright specs
the user can run in CI.

## Available tools (in addition to mcp__playwright__*)

The mcp__hover_dev_security_flows__* MCP server exposes:
- list_flows                  enumerate captured HTTP flows
- get_flow(id)                full headers + body of one flow
- replay_flow(id, mutation?)  re-send with optional method / url / headers / body overrides
- clear_flows                 drop captured flows between probe rounds

Every HTTPS request from the secured Chrome is decrypted and captured.
Use mcp__playwright__* to drive the UI (login, click, submit), then
list_flows to see what API calls happened, then replay_flow to probe
for vulnerabilities by mutating the captured request.

## Scope — what to look for

Focus on three categories, in this order of payoff:

**1. Authorisation / authentication (highest signal)**
- IDOR — change a resource id in a captured URL and replay; a 200 OK
  is the vulnerability
- Authentication bypass — drop or swap the auth header in a replay
- Parameter tampering — mutate request body fields (user_id, role,
  price, isAdmin) and replay; check whether the server accepts them
- Mass assignment — add fields the form didn't expose (admin: true,
  email: "victim@…") and see if they take effect

**2. Frontend / browser-side issues**
- XSS — try injecting <script>, javascript:, or onerror= into URL
  params, form inputs, and (especially) postMessage handlers
- Open redirects — find URL params that control redirect targets
- DOM clobbering / prototype pollution — only flag if you can show a
  concrete impact, not theoretical surface
- Missing security headers — check captured response headers for
  CSP, X-Frame-Options, Strict-Transport-Security, SameSite cookies

**3. Compliance / privacy (GDPR / CCPA signals)**
- PII in URL query strings (email, name, phone in GET params)
- Cookies without Secure / HttpOnly / SameSite when carrying session data
- Third-party requests carrying user data before consent was granted

## Methodology

1. Drive the user's typical flow once (login, navigate a few pages,
   submit a form). Don't analyse yet — just generate flows.
2. list_flows to see the API surface that was hit.
3. Pick ONE concrete hypothesis (e.g. "can user A read user B's orders?").
4. get_flow on the relevant captured request to see headers + body.
5. replay_flow with the mutation that would test that hypothesis.
6. Inspect the response. A 403 or 404 is the secure outcome; a 200 with
   the victim's data is the finding.
7. Report the finding as: what you sent, what came back, the impact.
8. When the user is satisfied, save findings as a Playwright spec via
   the regular save-spec flow. The saved spec MUST NOT depend on the
   MITM proxy — express the probe as page.request.fetch() or
   page.route() + page.evaluate(), and assert on the server response.

## Boundaries — DO NOT attempt

- SQL injection, SSRF, command injection, deserialisation attacks —
  these are server-side concerns this framework can't usefully test.
  Note them as out-of-scope if observed; do not try to exploit.
- Don't exfiltrate real user data even if reachable; this is a dev
  environment. Use placeholder ids when demonstrating.
- Don't run automated fuzzing loops; stay surgical — one hypothesis,
  one targeted replay, one observation.
- Don't disable or modify the user's CSP / cookie settings; only
  probe the application as deployed.

## Reporting style

When you complete a session, summarise findings in a short \`## Findings\`
block using these markers so the widget can colour-code them:
- **Bug**     — concrete vulnerability with reproducible impact
- **Minor**   — weak hardening, no immediate exploit (e.g. missing header)
- (no marker) — informational observation
`;

/** Resolve the absolute path to the bundled MCP-server script. We resolve
 *  it relative to this module's URL so it works in both built `dist/` form
 *  (when this file is `dist/index.js`) and source `src/` form (when
 *  consumers point package.json `main` at `src/`). */
function resolveMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // After build: dist/index.js → dist/mcp/server.js
  // Source form via tsx: src/index.ts → src/mcp/server.ts (tsx executes .ts)
  // We always emit `mcp/server.js` next to ourselves; tsx + plain Node both
  // resolve it because the security package's main entry is published as
  // dist anyway.
  return resolve(here, 'mcp', 'server.js');
}

export default defineHoverPlugin<SecurityModeOptions | void>((opts) => {
  const cdpPort = opts?.cdpPort ?? DEFAULT_CDP_PORT;
  const userDataDir = opts?.userDataDir ?? DEFAULT_USER_DATA_DIR;

  // Closed-over handles so the activate hook can boot the sidecars and
  // the deactivate / shutdown hooks can stop them. One factory call ⇒
  // one set of handles (Hover instantiates the manifest once per service).
  let proxy: ProxyHandle | null = null;
  let control: ControlPlaneHandle | null = null;

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

    mcpServers: [
      {
        id: MCP_SERVER_ID,
        // Resolved at manifest construction. The activate hook fills in
        // HOVER_SECURITY_API and HOVER_SECURITY_API_TOKEN via
        // ctx.setMcpServerEnv() — those values don't exist until then.
        command: process.execPath, // current Node binary — guarantees the same runtime
        args: [resolveMcpScriptPath()],
      },
    ],

    systemPromptAdditions: [
      {
        text: SECURITY_SYSTEM_PROMPT,
      },
    ],

    widgetEventTypes: ['security:flow:added', 'security:flow:updated'],

    hooks: {
      async 'hover:mode:activate'(ctx) {
        if (proxy && control) return; // idempotent re-activate

        proxy = await startProxy(ctx.devRoot);
        ctx.setChromeProxy({ port: proxy.port, spki: proxy.ca.spki });

        // Spin up the local HTTP control plane that the MCP server (a
        // separate child process spawned by the agent) will talk to.
        control = await startControlPlane(proxy.store);
        ctx.setMcpServerEnv(MCP_SERVER_ID, {
          HOVER_SECURITY_API: `http://127.0.0.1:${control.port}`,
          HOVER_SECURITY_API_TOKEN: control.token,
        });

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
        await control?.stop();
        control = null;
        await proxy?.stop();
        proxy = null;
      },

      async 'hover:service:shutdown'() {
        await control?.stop();
        control = null;
        await proxy?.stop();
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
