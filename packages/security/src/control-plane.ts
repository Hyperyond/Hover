/**
 * Local HTTP control plane for security-mode.
 *
 * Sits in front of the FlowStore + replayFlow primitives. Bound to
 * 127.0.0.1 on a free port; the port is written into the MCP server's
 * env (HOVER_SECURITY_API) by the plugin's activate hook, so the agent's
 * MCP subprocess can talk to it without any out-of-band coordination.
 *
 * Endpoints (all JSON in/out):
 *   GET    /health             → { ok: true, flows: N }
 *   GET    /flows              → { flows: FlowSummary[] }
 *   GET    /flows/:id          → Flow (full)
 *   POST   /flows/:id/replay   → { replayId, flow } | { error }
 *   DELETE /flows              → { cleared: N }
 *
 * Auth: a process-random shared secret (HOVER_SECURITY_API_TOKEN) is
 * required as Bearer on every request. The MCP server reads the same
 * env var so the secret never leaves the plugin process tree.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { FlowStore } from './mitm/flows.js';
import { replayFlow, type MutateOptions } from './mitm/replay.js';

const PORT_RETRIES = 10;
const DEFAULT_PORT = 51850;

export interface ControlPlaneHandle {
  port: number;
  token: string;
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
        sendJson(res, 200, { ok: true, flows: store.list().length });
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
        let mutate: MutateOptions | undefined;
        try {
          const body = await readBody(req);
          if (body) mutate = JSON.parse(body) as MutateOptions;
        } catch (err) {
          sendJson(res, 400, { error: 'invalid JSON body', detail: String(err) });
          return;
        }
        const result = await replayFlow(store, id, mutate);
        if ('error' in result) {
          sendJson(res, 404, result);
          return;
        }
        sendJson(res, 200, { replayId: result.replayId, flow: result.flow });
        return;
      }

      if (req.method === 'DELETE' && path === '/flows') {
        const n = store.list().length;
        store.clear();
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
    async stop() {
      await new Promise<void>((res) => {
        server.close(() => res());
      });
    },
  };
}
