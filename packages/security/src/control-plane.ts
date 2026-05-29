/**
 * Local HTTP control plane for security-mode.
 *
 * Sits in front of the FlowStore + replayFlow primitives. Bound to
 * 127.0.0.1 on a free port; the port is written into the MCP server's
 * env (HOVER_SECURITY_API) by the plugin's activate hook, so the agent's
 * MCP subprocess can talk to it without any out-of-band coordination.
 *
 * Endpoints (all JSON in/out):
 *   GET    /health             → { ok: true, flows: N, checks: M }
 *   GET    /flows              → { flows: FlowSummary[] }
 *   GET    /flows/:id          → Flow (full)
 *   POST   /flows/:id/replay   → { replayId, flow } | { error }
 *   DELETE /flows              → { cleared: N }
 *
 *   v0.12 — security recording:
 *   GET    /checks             → { checks: SecurityCheckStep[] }
 *   DELETE /checks             → { cleared: N }
 *
 * Auth: a process-random shared secret (HOVER_SECURITY_API_TOKEN) is
 * required as Bearer on every request. The MCP server reads the same
 * env var so the secret never leaves the plugin process tree.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Flow, FlowStore } from './mitm/flows.js';
import { replayFlow, type MutateOptions } from './mitm/replay.js';

const PORT_RETRIES = 10;
const DEFAULT_PORT = 51850;

/**
 * One recorded security check — a replay the agent did with a stated
 * intent + an expected response status. These accumulate as the agent
 * probes the app; "Save as Security spec" crystallises them into a
 * regression spec.
 *
 * The `observed` block carries what actually happened (method, url,
 * status, body excerpt) so the saved spec can assert against the
 * real ground truth (and so the user can see "expected 403, observed
 * 200 — vulnerability!" findings the agent noticed).
 */
export interface SecurityCheckStep {
  /** Monotonic id within this session, useful for stable ordering. */
  id: number;
  /** Source flow this check derives from. The captured request gave
   *  the agent the URL / cookies / auth state it then mutated. */
  sourceFlowId: string;
  /** Resulting replayed flow id (the mutation's target). */
  replayId: string;
  /** Agent-supplied human description, e.g. "IDOR: access another
   *  user's order". Required — without intent the check is just a
   *  replay, not a security assertion. */
  intent: string;
  /** Agent-stated expectation. Spec emit uses this to write the
   *  assertion. The observed status is recorded separately so the
   *  spec can distinguish "passed" from "vulnerability found". */
  expectStatus: number;
  /** What actually came back. */
  observed: {
    method: string;
    url: string;
    status: number;
    statusMessage: string | null;
    bodyExcerpt: string | null;
  };
  /** Whether observed === expected. Spec emit uses this to bucket
   *  checks into "regression assertions" (pass on fix) vs "verified
   *  controls" (already passing). */
  matched: boolean;
  /** Wall-clock when the check was recorded. */
  recordedAt: number;
}

export interface ControlPlaneHandle {
  port: number;
  token: string;
  /** Read the current SecurityCheckStep[] in-process — used by the
   *  plugin's hooks to forward checks to the widget without going
   *  through HTTP. Returns a copy so callers can mutate freely. */
  listChecks(): SecurityCheckStep[];
  /** Subscribe to per-check events (one per recorded check). */
  on(event: 'check', listener: (check: SecurityCheckStep) => void): void;
  off(event: 'check', listener: (check: SecurityCheckStep) => void): void;
  stop(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function bindServer(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: '127.0.0.1', port });
  });
}

export async function startControlPlane(store: FlowStore): Promise<ControlPlaneHandle> {
  const token = randomBytes(24).toString('hex');

  // Recorded security checks. Lives next to the FlowStore but conceptually
  // distinct — flows are *what the proxy saw*, checks are *what the agent
  // decided was a security assertion*. The Save-as-Security-spec path
  // reads this list. Cleared on `DELETE /checks` or `clear_flows` style
  // session reset.
  const checks: SecurityCheckStep[] = [];
  let nextCheckId = 1;
  const emitter = new EventEmitter();

  const recordCheck = (raw: {
    sourceFlowId: string;
    replayFlow: Flow;
    intent: string;
    expectStatus: number;
  }): SecurityCheckStep => {
    const obs = raw.replayFlow.response;
    const observed: SecurityCheckStep['observed'] = {
      method: raw.replayFlow.request.method,
      url: raw.replayFlow.request.url,
      status: obs?.statusCode ?? 0,
      statusMessage: obs?.statusMessage ?? null,
      bodyExcerpt:
        obs?.bodyText && obs.bodyText.length > 0
          ? obs.bodyText.slice(0, 500)
          : null,
    };
    const check: SecurityCheckStep = {
      id: nextCheckId++,
      sourceFlowId: raw.sourceFlowId,
      replayId: raw.replayFlow.id,
      intent: raw.intent,
      expectStatus: raw.expectStatus,
      observed,
      matched: observed.status === raw.expectStatus,
      recordedAt: Date.now(),
    };
    checks.push(check);
    emitter.emit('check', check);
    return check;
  };

  const server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${token}`) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;

      if (req.method === 'GET' && path === '/health') {
        sendJson(res, 200, {
          ok: true,
          flows: store.list().length,
          checks: checks.length,
        });
        return;
      }

      if (req.method === 'GET' && path === '/checks') {
        sendJson(res, 200, { checks: [...checks] });
        return;
      }

      if (req.method === 'DELETE' && path === '/checks') {
        const n = checks.length;
        checks.length = 0;
        sendJson(res, 200, { cleared: n });
        return;
      }

      if (req.method === 'GET' && path === '/flows') {
        // Summary view — no bodies. Keeps responses small when there are
        // hundreds of captured flows in a long session.
        const flows = store.list().map((f) => ({
          id: f.id,
          mutated: f.mutated,
          request: {
            method: f.request.method,
            url: f.request.url,
            httpVersion: f.request.httpVersion,
            startedAt: f.request.startedAt,
            bodyLen: f.request.bodyLen,
          },
          response: f.response
            ? {
                statusCode: f.response.statusCode,
                statusMessage: f.response.statusMessage,
                completedAt: f.response.completedAt,
                bodyLen: f.response.bodyLen,
              }
            : null,
        }));
        sendJson(res, 200, { flows });
        return;
      }

      const flowMatch = /^\/flows\/([a-f0-9]+)$/.exec(path);
      if (req.method === 'GET' && flowMatch) {
        const flow = store.get(flowMatch[1]);
        if (!flow) {
          sendJson(res, 404, { error: 'not found' });
          return;
        }
        sendJson(res, 200, flow);
        return;
      }

      const replayMatch = /^\/flows\/([a-f0-9]+)\/replay$/.exec(path);
      if (req.method === 'POST' && replayMatch) {
        const id = replayMatch[1];
        // The request body carries replay mutation params (method/url/etc)
        // PLUS optional security-recording fields (intent, expectStatus).
        // The recording fields are stripped before being passed to
        // replayFlow — only the mutation subset is honoured for actual
        // request rewriting.
        let parsed:
          | (MutateOptions & { intent?: string; expectStatus?: number })
          | undefined;
        try {
          const body = await readBody(req);
          if (body) parsed = JSON.parse(body);
        } catch (err) {
          sendJson(res, 400, { error: 'invalid JSON body', detail: String(err) });
          return;
        }
        const { intent, expectStatus, ...mutate } = parsed ?? {};
        const result = await replayFlow(store, id, mutate);
        if ('error' in result) {
          sendJson(res, 404, result);
          return;
        }
        // Record a security check when the caller supplied BOTH intent
        // and expectStatus. Either alone is insufficient: intent without
        // expectStatus has no assertion to make; expectStatus without
        // intent gives the spec no human-readable rationale.
        let check: SecurityCheckStep | null = null;
        if (typeof intent === 'string' && intent.trim().length > 0 && typeof expectStatus === 'number') {
          check = recordCheck({
            sourceFlowId: id,
            replayFlow: result.flow,
            intent: intent.trim(),
            expectStatus,
          });
        }
        sendJson(res, 200, {
          replayId: result.replayId,
          flow: result.flow,
          ...(check ? { check } : {}),
        });
        return;
      }

      if (req.method === 'DELETE' && path === '/flows') {
        const n = store.list().length;
        store.clear();
        // Checks reference flow ids — clearing flows without clearing
        // checks would leave the spec emitter pointing at dangling ids.
        // We don't broadcast a 'check' event for each cleared entry;
        // callers should treat clear-flows as "session reset" too.
        checks.length = 0;
        sendJson(res, 200, { cleared: n });
        return;
      }

      sendJson(res, 404, { error: 'unknown route', method: req.method, path });
    })().catch((err) => {
      sendJson(res, 500, {
        error: 'internal',
        detail: err instanceof Error ? err.message : String(err),
      });
    });
  });

  let boundPort = 0;
  let lastErr: unknown = null;
  for (let i = 0; i < PORT_RETRIES; i++) {
    try {
      await bindServer(server, DEFAULT_PORT + i);
      boundPort = DEFAULT_PORT + i;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!boundPort) {
    throw new Error(
      `[hover-security] control plane couldn't bind in [${DEFAULT_PORT}, ${DEFAULT_PORT + PORT_RETRIES}): ` +
        (lastErr instanceof Error ? lastErr.message : String(lastErr)),
    );
  }

  return {
    port: boundPort,
    token,
    listChecks: () => [...checks],
    on: (event, listener) => {
      emitter.on(event, listener);
    },
    off: (event, listener) => {
      emitter.off(event, listener);
    },
    async stop() {
      await new Promise<void>((res) => {
        server.close(() => res());
      });
    },
  };
}
