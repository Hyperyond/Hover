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
