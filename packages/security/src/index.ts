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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy, type ProxyHandle } from './mitm/index.js';
import { startControlPlane, type ControlPlaneHandle } from './control-plane.js';

export interface SecurityModeOptions {
  /** @deprecated Single-Chrome model: security no longer launches a second
   *  Chrome on a separate port. The one debug Chrome (normal CDP port) is born
   *  pointed through the resident MITM proxy; entering Security mode flips the
   *  proxy to intercept. This option is ignored and kept only so existing
   *  configs don't error. */
  cdpPort?: number;
  /** @deprecated See `cdpPort` — ignored in the single-Chrome model. */
  userDataDir?: string;
  /** Second identities for IDOR/BOLA probing — label → Playwright
   *  `storageState` file path (relative to the project root). The agent can
   *  replay a captured request AS one of these via the `replay_flow` tool's
   *  `as` argument, and a cross-identity finding crystallizes into a
   *  multi-role `browser.newContext({ storageState })` spec. */
  identities?: Record<string, string>;
}

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

/** Resolve the absolute path to the widget contribution module. Same
 *  relative-to-self trick as resolveMcpScriptPath. The Hover widget host
 *  reads this file at bundle-assembly time and inlines it as a
 *  `<script type="module">` after the widget core. The package's build
 *  step copies `src/widget.js` to `dist/widget.js` (`widget.js` is
 *  authored as plain JS — tsc doesn't compile it). */
function resolveWidgetScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'widget.js');
}

export default defineHoverPlugin<SecurityModeOptions | void>((opts) => {
  // Closed-over handles so the service:start hook can boot the resident
  // sidecars and the shutdown hook can stop them. One factory call ⇒ one set
  // of handles (Hover instantiates the manifest once per service).
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
      engagedHint: 'MITM proxy active',
    },

    // No chromeFlags: the single debug Chrome is launched by the core service
    // (on the normal CDP port) with the resident proxy baked in via the
    // service:start hook's setChromeProxy — no separate port / profile.

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

    widgetEventTypes: [
      'security:flow:added',
      'security:flow:updated',
      // v0.12 — each agent-driven recordable replay (the agent passed
      // intent + expectStatus to replay_flow) emits a check event. The
      // widget's Specs / Findings UI uses it to surface "agent recorded
      // a security check" rows.
      'security:check:recorded',
    ],

    // v0.12 — Save dropdown contribution. Widget surfaces this in the
    // Save-as menu under the Result card whenever security mode is
    // active. Handler reads checks live from the control plane (closure)
    // so we don't have to round-trip the SecurityCheckStep[] through
    // the widget — which would otherwise force the widget to also
    // know the full SecurityCheckStep shape.
    saveHandlers: [
      {
        type: 'save:security:spec',
        label: 'Security spec',
        description:
          'Playwright regression spec from the agent\'s recorded replay decisions. Runs in CI without MITM or agent.',
        handle: async ({ devRoot, payload }) => {
          if (!control) {
            throw new Error('Security mode is not active — no control plane to read checks from.');
          }
          const checks = control.listChecks();
          if (checks.length === 0) {
            throw new Error(
              'No security checks recorded in this session. Have the agent run replay_flow with intent + expectStatus first.',
            );
          }
          const p = (payload ?? {}) as {
            name?: string;
            description?: string;
            summary?: string;
            overwrite?: boolean;
          };
          if (typeof p.name !== 'string' || !p.name.trim()) {
            throw new Error('save:security:spec: name is required');
          }
          const { writeSecuritySpec } = await import('./writeSecuritySpec.js');
          const result = await writeSecuritySpec({
            devRoot,
            name: p.name,
            description: p.description,
            summary: p.summary,
            checks,
            overwrite: p.overwrite === true,
          });
          return { path: result.path, slug: result.slug };
        },
      },
    ],

    widgetEntry: resolveWidgetScriptPath(),

    hooks: {
      // Single-Chrome model: the MITM proxy is RESIDENT. It starts here, at
      // service start, BEFORE the host launches the one debug Chrome — so
      // Chrome is born pointed through it (transparent passthrough by
      // default). Entering Security mode no longer launches a second Chrome;
      // it just flips the proxy into intercept mode (see mode:activate).
      async 'hover:service:start'(ctx) {
        if (proxy && control) return; // idempotent

        proxy = await startProxy(ctx.devRoot); // defaults to passthrough
        // Tell the host to bake the proxy + CA pin into the single Chrome
        // launch. Set once; lasts the whole session.
        ctx.setChromeProxy({ port: proxy.port, spki: proxy.ca.spki });

        // Control plane (the local HTTP API the agent's MCP server talks to)
        // is also resident — harmless when idle, and avoids a start/stop race
        // on every mode toggle.
        control = await startControlPlane(proxy.store, {
          devRoot: ctx.devRoot,
          identities: opts?.identities,
        });
        ctx.setMcpServerEnv(MCP_SERVER_ID, {
          HOVER_SECURITY_API: `http://127.0.0.1:${control.port}`,
          HOVER_SECURITY_API_TOKEN: control.token,
        });

        // Forward FlowStore events to the widget (only emitted while the
        // proxy is in intercept mode, so this is quiet in passthrough).
        proxy.store.on('event', (e) => {
          ctx.broadcast({
            type: e.type === 'flow:added' ? 'security:flow:added' : 'security:flow:updated',
            payload: e.flow,
          });
        });

        // v0.12 — forward newly recorded security checks for the widget's
        // Save-as-Security-spec running count.
        control.on('check', (check) => {
          ctx.broadcast({
            type: 'security:check:recorded',
            payload: check,
          });
        });
      },

      // Enter Security mode: flip the resident proxy to intercept. No Chrome
      // relaunch, no second instance — the same already-proxied Chrome simply
      // starts having its traffic recorded.
      async 'hover:mode:activate'() {
        proxy?.setMode('intercept');
      },

      // Leave Security mode: back to transparent passthrough. The proxy and
      // control plane stay up (resident); we just stop recording.
      async 'hover:mode:deactivate'() {
        proxy?.setMode('passthrough');
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

// Probe engine — the shared access-control primitives from the private
// @hover-dev/probe-engine (inlined into our dist at build via tsup noExternal;
// never a runtime npm dependency). Re-exported so consumers can match/sanitize/
// gate against captured flows. A FlowRequest is structurally a ProbeRequest.
export {
  type ProbeRequest,
  type ProbeFlow,
  type SecurityClass,
  type SecuritySeed,
  isSecuritySeed,
  loadSecuritySeeds,
  hasAuth,
  matchesFlow,
  matchSeeds,
  type SanitizedRequest,
  sanitizeRequest,
  type Verdict,
  type FindingSignals,
  type GateResult,
  NEVER_SUBMIT,
  gateFinding,
} from '@hover-dev/probe-engine';
