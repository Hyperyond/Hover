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

// ---------------------------------------------------------------------------
// Resident MITM proxy — a PROCESS singleton, refcounted.
//
// Only ONE proxy can own the debug Chrome: Chrome is born with `--proxy-server`
// pointed at it (setChromeProxy at service start), so a second proxy would run
// orphaned and capture nothing. But two plugins legitimately need it — the
// orange security mode AND the red pentest mode (`@hover-dev/pentest/plugin`,
// which reaches the proxy through `startSecurityRuntime` below). Both resolve
// `@hover-dev/security` to the same module instance, so this module-level
// singleton is genuinely shared between them: the first to start the proxy wins,
// the rest get the same handle (same port + CA), and it stops only when the last
// holder releases. The active mode owns intercept/passthrough — the modes are
// mutually exclusive (`conflictsWith`), so they never fight over it.
let residentProxy: { proxy: ProxyHandle; refs: number } | null = null;

async function acquireResidentProxy(devRoot: string): Promise<ProxyHandle> {
  if (residentProxy) {
    residentProxy.refs += 1;
    return residentProxy.proxy;
  }
  const proxy = await startProxy(devRoot); // defaults to passthrough
  residentProxy = { proxy, refs: 1 };
  return proxy;
}

async function releaseResidentProxy(): Promise<void> {
  if (!residentProxy) return;
  residentProxy.refs -= 1;
  if (residentProxy.refs <= 0) {
    const { proxy } = residentProxy;
    residentProxy = null;
    await proxy.stop();
  }
}

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

        // Shared resident proxy (refcounted) — co-exists with the pentest
        // plugin, which acquires the same one via startSecurityRuntime.
        proxy = await acquireResidentProxy(ctx.devRoot); // defaults to passthrough
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
        await releaseResidentProxy();
        proxy = null;
      },
    },
  };

  return manifest;
});

// ---------------------------------------------------------------------------
// Headless runtime entry — the composition seat for callers that DON'T have the
// Hover Vite service (the `hover scan` CLI; future headless harnesses). It boots
// the exact same sidecars the `hover:service:start` hook does — resident MITM
// proxy (flipped straight to intercept, since a scan always records) + the local
// control plane the security MCP server talks to — and hands back everything the
// caller needs to: launch a proxied Chrome (proxyPort + spki), wire the security
// MCP server into an agent's MCP config (mcpServerId + mcpScriptPath + mcpEnv),
// read the recorded checks (listChecks), and tear it all down (stop).
//
// Why it lives here, not in the CLI: `mitm` and `control-plane` are bundled into
// this package's dist by tsup, so they're unreachable by deep import — the
// composition has to be exported from the package that owns the internals. The
// CLI stays a thin orchestrator.

export interface SecurityRuntimeOptions {
  /** Project root — where the MITM CA is cached and identity storageState paths
   *  resolve against. */
  devRoot: string;
  /** Second identities for cross-identity (IDOR/BOLA) replay — label →
   *  storageState path relative to devRoot. */
  identities?: Record<string, string>;
  /** Start recording immediately. The CLI scan wants this (no mode toggle).
   *  The widget pentest plugin passes `false` and flips it via `setIntercept`
   *  on mode activate/deactivate. Default `true`. */
  intercept?: boolean;
  /** Override the MCP server id (the tool prefix + allow-list entry). The
   *  pentest plugin passes its own id so it doesn't collide with the security
   *  plugin's server when both are loaded. Defaults to the security id. */
  mcpServerId?: string;
}

export interface SecurityRuntimeHandle {
  /** mockttp proxy port — pass to Chrome's `--proxy-server=127.0.0.1:<port>`. */
  proxyPort: number;
  /** base64 SHA-256 of the MITM CA SubjectPublicKeyInfo — pass to Chrome's
   *  `--ignore-certificate-errors-spki-list` (via launchDebugChrome's `proxy`). */
  spki: string;
  /** MCP server id — the `mcp__<sanitised id>__*` tool prefix and the
   *  allow-list entry the agent needs (`allowedToolsExtra`). */
  mcpServerId: string;
  /** Absolute path to the bundled security MCP server script (spawn with
   *  `process.execPath`). */
  mcpScriptPath: string;
  /** Env the MCP server needs to reach the control plane. */
  mcpEnv: Record<string, string>;
  /** Flip recording on (intercept) / off (passthrough) without a restart —
   *  the widget pentest plugin calls this on mode activate/deactivate. */
  setIntercept(on: boolean): void;
  /** Snapshot the checks the agent recorded so far (a copy). */
  listChecks(): import('./control-plane.js').SecurityCheckStep[];
  /** Coverage gaps the agent recorded (what it did NOT test) — feeds the
   *  findings report's "Not tested" section. */
  listGaps(): string[];
  /** Subscribe to each recorded check (for a widget running count). */
  onCheck(listener: (check: import('./control-plane.js').SecurityCheckStep) => void): void;
  /** Stop this caller's control plane + release the shared proxy. Idempotent. */
  stop(): Promise<void>;
}

/** Boot the security sidecars for a caller that DOESN'T own the Hover service
 *  (the `hover scan` CLI; the `@hover-dev/pentest/plugin` widget mode). Shares
 *  the refcounted resident proxy so it coexists with the security plugin. */
export async function startSecurityRuntime(
  opts: SecurityRuntimeOptions,
): Promise<SecurityRuntimeHandle> {
  const proxy = await acquireResidentProxy(opts.devRoot);
  // CLI scan records immediately; the widget plugin starts quiet and toggles.
  proxy.setMode(opts.intercept === false ? 'passthrough' : 'intercept');

  const control = await startControlPlane(proxy.store, {
    devRoot: opts.devRoot,
    identities: opts.identities,
  });

  let stopped = false;
  return {
    proxyPort: proxy.port,
    spki: proxy.ca.spki,
    mcpServerId: opts.mcpServerId ?? MCP_SERVER_ID,
    mcpScriptPath: resolveMcpScriptPath(),
    mcpEnv: {
      HOVER_SECURITY_API: `http://127.0.0.1:${control.port}`,
      HOVER_SECURITY_API_TOKEN: control.token,
    },
    setIntercept: (on) => proxy.setMode(on ? 'intercept' : 'passthrough'),
    listChecks: () => control.listChecks(),
    listGaps: () => control.listGaps(),
    onCheck: (listener) => control.on('check', listener),
    async stop() {
      if (stopped) return;
      stopped = true;
      await control.stop();
      await releaseResidentProxy();
    },
  };
}

/** Absolute path to the bundled security MCP server script — so a sibling
 *  plugin (pentest) can register the SAME server under its own id without
 *  duplicating the resolver. */
export function securityMcpScriptPath(): string {
  return resolveMcpScriptPath();
}

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

// The recorded-check shape, so downstream packages (e.g. @hover-dev/pentest)
// can render reports / specs from a session's checks without re-deriving it.
export type { SecurityCheckStep } from './control-plane.js';

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
