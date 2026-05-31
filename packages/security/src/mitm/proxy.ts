/**
 * mockttp lifecycle wrapper for security-mode.
 *
 * Boots a forward HTTPS proxy on a free port in [DEFAULT_PORT, +PORT_RETRIES)
 * and forwards every request untouched. The proxy is *resident*: it starts
 * once when the security plugin loads and the single debug Chrome is launched
 * pointed through it, so there is no second Chrome. It has two runtime modes,
 * flipped by `setMode()` with no proxy/Chrome restart:
 *
 *   - 'passthrough' (default): the hot loop returns immediately without
 *     reading bodies or recording — behaviourally transparent, so normal
 *     dev/debugging through this Chrome is unaffected.
 *   - 'intercept': request/response pairs (with bodies) are piped into the
 *     FlowStore so the agent can inspect/replay them. Entered when the user
 *     switches the widget into Security mode.
 *
 * Stop is idempotent so the service teardown can call it unconditionally.
 */
import * as mockttp from 'mockttp';
import { loadOrCreateCa, type CaMaterial } from './ca.js';
import { FlowStore, type FlowRequest, type FlowResponse } from './flows.js';

const DEFAULT_PROXY_PORT = 8080;
const PROXY_PORT_RETRIES = 10;

export type ProxyMode = 'passthrough' | 'intercept';

export interface ProxyHandle {
  /** The port the proxy actually bound to. */
  port: number;
  ca: CaMaterial;
  store: FlowStore;
  /** Flip recording on/off at runtime. No proxy or Chrome restart. */
  setMode(mode: ProxyMode): void;
  /** Current mode — handy for tests / status. */
  getMode(): ProxyMode;
  stop(): Promise<void>;
}

function asHeaderRecord(
  headers: mockttp.Headers,
): Record<string, string | string[] | undefined> {
  // mockttp.Headers is already a plain object of name → value | value[], but
  // its declared type is wider than we want to push to the widget. Coerce.
  return { ...headers };
}

async function readBody(
  source: { getText(): Promise<string | undefined>; buffer?: Buffer } | undefined,
): Promise<{ bodyText: string | null; bodyLen: number }> {
  if (!source) return { bodyText: null, bodyLen: 0 };
  try {
    const text = await source.getText();
    if (text === undefined) {
      // Binary — record length only
      const buf = (source as { buffer?: Buffer }).buffer;
      return { bodyText: null, bodyLen: buf?.length ?? 0 };
    }
    return { bodyText: text, bodyLen: Buffer.byteLength(text) };
  } catch {
    return { bodyText: null, bodyLen: 0 };
  }
}

export async function startProxy(devRoot: string): Promise<ProxyHandle> {
  const ca = await loadOrCreateCa(devRoot);
  const store = new FlowStore();

  const server = mockttp.getLocal({
    https: { keyPath: ca.keyPath, certPath: ca.certPath },
    http2: true,
  });

  // Map mockttp request.id → our Flow.id so we can correlate response
  // callbacks back to the right entry without scanning the store.
  const idMap = new Map<string, string>();

  // Runtime mode. Default 'passthrough' so the resident proxy is transparent
  // until the user enters Security mode (setMode('intercept')). Held in a
  // closure variable the callbacks read on every request — flipping it needs
  // no rule swap and no Chrome/proxy restart.
  let mode: ProxyMode = 'passthrough';

  await server.forAnyRequest().thenPassThrough({
    beforeRequest: async (req) => {
      // Transparent fast-path: in passthrough we forward untouched and, in
      // particular, do NOT call getText() — body-buffering every request on a
      // proxy that's always in the path would tax normal dev traffic.
      if (mode === 'passthrough') return {};
      const { bodyText, bodyLen } = await readBody(req.body);
      const flowReq: FlowRequest = {
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion ?? '?',
        headers: asHeaderRecord(req.headers),
        bodyText,
        bodyLen,
        startedAt: Date.now(),
      };
      const flow = store.add(flowReq);
      idMap.set(req.id, flow.id);
      return {};
    },
    beforeResponse: async (res) => {
      // Only correlate responses for requests we recorded (i.e. captured
      // while in intercept mode). idMap is empty in passthrough, so this is
      // a no-op there even if a request straddled a mode flip.
      const ourId = idMap.get(res.id);
      if (!ourId) return {};
      const { bodyText, bodyLen } = await readBody(res.body);
      const flowRes: FlowResponse = {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        headers: asHeaderRecord(res.headers),
        bodyText,
        bodyLen,
        completedAt: Date.now(),
      };
      store.attachResponse(ourId, flowRes, false);
      idMap.delete(res.id);
      return {};
    },
  });

  // Find a free port. mockttp's start(port) throws on EADDRINUSE — every
  // other failure shape (bad CA key, missing crypto support, peculiar
  // schema-registry collisions) is fatal and should NOT be swallowed by
  // the port retry loop. Distinguish on the error message.
  let boundPort = 0;
  let lastErr: unknown = null;
  for (let i = 0; i < PROXY_PORT_RETRIES; i++) {
    const candidate = DEFAULT_PROXY_PORT + i;
    try {
      await server.start(candidate);
      boundPort = candidate;
      break;
    } catch (err) {
      lastErr = err;
      if (!isPortBusy(err)) {
        // Not a port issue — escalate immediately with diagnostics.
        throw augmentStartError(err);
      }
    }
  }
  if (!boundPort) {
    throw new Error(
      `[hover/mitm] no free port in [${DEFAULT_PROXY_PORT}, ${DEFAULT_PROXY_PORT + PROXY_PORT_RETRIES}): ` +
        (lastErr instanceof Error ? lastErr.message : String(lastErr)),
    );
  }

  let stopped = false;
  return {
    port: boundPort,
    ca,
    store,
    setMode(next: ProxyMode) {
      mode = next;
    },
    getMode() {
      return mode;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await server.stop();
      } catch {
        // best-effort
      }
    },
  };
}

function isPortBusy(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'EADDRINUSE' || code === 'EACCES') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /EADDRINUSE|EACCES|address already in use/i.test(message);
}

/** Translate the most common mockttp.start() failure shapes into an
 *  error message the user can act on. Detect-and-rewrite rather than
 *  raw stack — these errors come from deep inside transitive deps and
 *  the original messages are useless on their own. */
function augmentStartError(err: unknown): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const message = original.message;
  if (/Cannot get schema for ['"]PrivateKeyInfo['"]/i.test(message)) {
    const e = new Error(
      [
        '[hover/mitm] CA generation failed: @peculiar/asn1-schema schema-registry collision.',
        'Multiple copies of @peculiar/asn1-schema are loaded in the same process; PKI deps register schemas into one copy and look them up in another.',
        'Tracking upstream: https://github.com/PeculiarVentures/asn1-schema/issues/111',
        'Fix: pin a single version in your project root package.json:',
        '  { "pnpm": { "overrides": { "@peculiar/asn1-schema": "2.6.0" } } }',
        '  (npm: "overrides" at top level; yarn: "resolutions")',
        'Then: rm -rf node_modules && pnpm install',
      ].join('\n  '),
    );
    e.cause = original;
    return e;
  }
  return original;
}
