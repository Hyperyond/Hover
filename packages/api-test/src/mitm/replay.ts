/**
 * Flow replay & mutation primitives.
 *
 * Replays a captured Flow by reissuing the request from Node directly (NOT
 * through the proxy — that would loop forever). The resulting request +
 * response is recorded back into the FlowStore as a NEW flow so the agent
 * and the widget can see the difference.
 *
 * Mutation options override pieces of the captured request: method, url,
 * specific headers, body text. Anything omitted is taken verbatim from the
 * original flow.
 */
import type { Flow, FlowStore, FlowRequest, FlowResponse } from './flows.js';

export interface MutateOptions {
  method?: string;
  url?: string;
  /** Headers to override (case-insensitive merge with the original). Set a
   *  value to null to delete that header. */
  headers?: Record<string, string | null>;
  /** Replace the request body entirely with this UTF-8 string. */
  bodyText?: string;
  /** Bypass the same-origin guard. By default replay refuses to hit a
   *  target whose origin differs from the source flow's origin — this
   *  prevents an agent from accidentally probing a third-party API
   *  (Stripe, Sentry, …) that the dev app happens to call. Pass true
   *  only when the user explicitly authorises cross-origin replay. */
  allowCrossOrigin?: boolean;
}

/** Default per-replay timeout. Most authz probes return in <1s; 30s is
 *  generous for "the server is slow" without letting a hung target
 *  block the agent forever. */
const REPLAY_TIMEOUT_MS = 30_000;

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function mergeHeaders(
  original: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | null> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      const key = k.toLowerCase();
      if (v === null) {
        delete out[key];
      } else {
        out[key] = v;
      }
    }
  }
  // Drop hop-by-hop headers fetch handles itself.
  for (const k of ['host', 'content-length', 'connection', 'transfer-encoding']) {
    delete out[k];
  }
  return out;
}

export async function replayFlow(
  store: FlowStore,
  sourceId: string,
  mutate?: MutateOptions,
): Promise<{ replayId: string; flow: Flow } | { error: string }> {
  const source = store.get(sourceId);
  if (!source) return { error: `flow ${sourceId} not found` };

  const method = mutate?.method ?? source.request.method;
  const url = mutate?.url ?? source.request.url;
  const headers = mergeHeaders(source.request.headers, mutate?.headers);
  const bodyText = mutate?.bodyText ?? source.request.bodyText ?? undefined;
  const hasBody = bodyText !== undefined && method !== 'GET' && method !== 'HEAD';

  // Same-origin guard: an agent should not, by default, probe a third-
  // party API (Stripe, Sentry, analytics) the dev app happens to call.
  // The mutated URL must share an origin with the source flow's URL,
  // unless the caller explicitly opts in with `allowCrossOrigin`.
  if (!mutate?.allowCrossOrigin) {
    const sourceOrigin = originOf(source.request.url);
    const targetOrigin = originOf(url);
    if (sourceOrigin && targetOrigin && sourceOrigin !== targetOrigin) {
      return {
        error:
          `replay refused: cross-origin (source ${sourceOrigin}, target ${targetOrigin}). ` +
          `Pass allowCrossOrigin: true if you own / are authorised to test the target.`,
      };
    }
  }

  const newFlowReq: FlowRequest = {
    method,
    url,
    httpVersion: '?',
    headers,
    bodyText: bodyText ?? null,
    bodyLen: bodyText ? Buffer.byteLength(bodyText) : 0,
    startedAt: Date.now(),
  };
  const flow = store.add(newFlowReq);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? bodyText : undefined,
      signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
    });
    const resText = await res.text();
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });
    const flowRes: FlowResponse = {
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: resHeaders,
      bodyText: resText,
      bodyLen: Buffer.byteLength(resText),
      completedAt: Date.now(),
    };
    store.attachResponse(flow.id, flowRes, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const flowRes: FlowResponse = {
      statusCode: 0,
      statusMessage: `replay failed: ${msg}`,
      headers: {},
      bodyText: null,
      bodyLen: 0,
      completedAt: Date.now(),
    };
    store.attachResponse(flow.id, flowRes, true);
  }

  return { replayId: flow.id, flow };
}

/**
 * Issue an ARBITRARY request from scratch (not a replay of a captured flow) and
 * record it as a new flow. This is the request-first primitive behind the
 * `api_request` MCP tool: for API-only backends (no frontend to drive) the agent
 * calls endpoints directly here. Mirrors replayFlow's fetch + store-record path.
 *
 * Origin-locked like replayFlow: the target must share the origin of the app
 * being tested (inferred from already-captured flows) unless allowCrossOrigin is
 * set — so a hijacked prompt can't make api_request hit a third-party. Auth is
 * auto-carried: if no cookie is supplied, the session cookie from a same-origin
 * captured flow is reused (the browser's logged-in session).
 */
function headerValueOf(h: Record<string, string | string[] | undefined>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === lower && v !== undefined) return Array.isArray(v) ? v.join('; ') : v;
  }
  return null;
}

export async function issueRequest(
  store: FlowStore,
  opts: { method?: string; url: string; headers?: Record<string, string | null>; bodyText?: string; allowCrossOrigin?: boolean },
): Promise<{ requestId: string; flow: Flow } | { error: string }> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const url = opts.url;
  const targetOrigin = originOf(url);
  if (!url || !targetOrigin) return { error: `invalid url: ${url}` };

  // Origin lock: stay on the app under test. Reference = the origin of an
  // already-captured flow (what the browser is driving). An empty store (a pure-
  // API run's very first call) is allowed to bootstrap the origin.
  if (!opts.allowCrossOrigin) {
    let ref: string | null = null;
    for (const f of store.list()) { const o = originOf(f.request.url); if (o) { ref = o; break; } }
    if (ref && ref !== targetOrigin) {
      return {
        error:
          `request refused: cross-origin (app ${ref}, target ${targetOrigin}). ` +
          `Pass allowCrossOrigin: true only if you own / are authorised to test the target.`,
      };
    }
  }

  const headers = mergeHeaders({}, opts.headers);
  // Auto-carry the session: if the caller didn't set a cookie, reuse one from a
  // same-origin captured flow (the debug Chrome's logged-in session).
  if (!headers['cookie']) {
    for (const f of store.list()) {
      if (originOf(f.request.url) !== targetOrigin) continue;
      const c = headerValueOf(f.request.headers, 'cookie');
      if (c) { headers['cookie'] = c; break; }
    }
  }
  const bodyText = opts.bodyText;
  const hasBody = bodyText !== undefined && method !== 'GET' && method !== 'HEAD';

  const newFlowReq: FlowRequest = {
    method,
    url,
    httpVersion: '?',
    headers,
    bodyText: bodyText ?? null,
    bodyLen: bodyText ? Buffer.byteLength(bodyText) : 0,
    startedAt: Date.now(),
  };
  const flow = store.add(newFlowReq);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? bodyText : undefined,
      signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
    });
    const resText = await res.text();
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    store.attachResponse(flow.id, {
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: resHeaders,
      bodyText: resText,
      bodyLen: Buffer.byteLength(resText),
      completedAt: Date.now(),
    }, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.attachResponse(flow.id, {
      statusCode: 0,
      statusMessage: `request failed: ${msg}`,
      headers: {},
      bodyText: null,
      bodyLen: 0,
      completedAt: Date.now(),
    }, true);
  }

  return { requestId: flow.id, flow };
}
