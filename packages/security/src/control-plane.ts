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
import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import type { Flow, FlowStore } from './mitm/flows.js';
import { replayFlow, type MutateOptions } from './mitm/replay.js';
import { suggestProbes, cookieHeaderFor, type StorageState, type SecurityCheckStep, type BrowserFinding, type SeedCategory } from '@hover-dev/probe-engine';

const PORT_RETRIES = 10;
const DEFAULT_PORT = 51850;

// The closed SecurityClass union (probe-engine seed.ts) as a runtime set, so
// POST /finding can validate the agent-supplied `class` string instead of
// force-casting an arbitrary value into the typed union. Unrecognised values
// drop to undefined rather than corrupting the BrowserFinding shape.
const KNOWN_SECURITY_CLASSES: ReadonlySet<BrowserFinding['class']> = new Set<
  BrowserFinding['class']
>([
  // business / authorization
  'idor', 'bola', 'bfla', 'mass-assignment', 'auth-bypass',
  // vulnerability / attack
  'ssrf', 'open-redirect', 'path-traversal', 'cors', 'jwt',
  'sqli', 'xss', 'ssti', 'xxe', 'deserialization', 'rce', 'csrf', 'graphql',
]);

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
// The recorded-check shape now lives in the shared engine (the data contract
// security + pentest both use); imported above for local use. Re-export it so
// existing `from './control-plane.js'` imports — and security's public index —
// keep working unchanged.
export type { SecurityCheckStep };

export interface ControlPlaneHandle {
  port: number;
  token: string;
  /** Read the current SecurityCheckStep[] in-process — used by the
   *  plugin's hooks to forward checks to the widget without going
   *  through HTTP. Returns a copy so callers can mutate freely. */
  listChecks(): SecurityCheckStep[];
  /** Browser-confirmed findings the agent recorded (XSS via input, DOM-based,
   *  etc.) — attacks driven through the page, not via replay_flow. */
  listFindings(): BrowserFinding[];
  /** Coverage gaps the agent recorded — what it did NOT test and why. Feeds the
   *  findings report's "Not tested" section so a scan never reads as full
   *  coverage. */
  listGaps(): string[];
  /** Subscribe to per-check events (one per recorded check). */
  on(event: 'check', listener: (check: SecurityCheckStep) => void): void;
  /** Subscribe to session-reset events — fired when `DELETE /flows`
   *  (the `clear_flows` tool) wipes the store + checks. The plugin forwards
   *  this to the widget so its flows/checks state + badge don't go stale. */
  onClear(listener: () => void): void;
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

export interface ControlPlaneOptions {
  /** Project root — relative identity storageState paths resolve against it. */
  devRoot?: string;
  /** Label → Playwright storageState file path, for replaying as a second
   *  identity (IDOR/BOLA). e.g. { userB: 'state/userB.json' }. */
  identities?: Record<string, string>;
  /** Restrict probe suggestions to these seed categories. Security mode passes
   *  `['authz']` so the agent only sees access-control probes; left undefined
   *  (the CLI scan + pentest plugin) means all seeds. */
  seedCategories?: SeedCategory[];
}

export async function startControlPlane(
  store: FlowStore,
  options: ControlPlaneOptions = {},
): Promise<ControlPlaneHandle> {
  const identities = options.identities ?? {};
  const identityRoot = options.devRoot ?? process.cwd();
  const stateCache = new Map<string, StorageState>();

  // Resolve a configured identity to a Cookie header for `url`, reading +
  // caching its storageState file. Returns { error } on misconfig/IO failure.
  const identityCookie = async (
    label: string,
    url: string,
  ): Promise<string | { error: string }> => {
    const rel = identities[label];
    if (!rel) {
      return { error: `unknown identity "${label}" — configure it in securityMode({ identities }).` };
    }
    let state = stateCache.get(rel);
    if (!state) {
      const abs = isAbsolute(rel) ? rel : resolve(identityRoot, rel);
      try {
        state = JSON.parse(await readFile(abs, 'utf-8')) as StorageState;
      } catch (err) {
        return { error: `could not read storageState for "${label}" at ${rel}: ${String(err)}` };
      }
      stateCache.set(rel, state);
    }
    return cookieHeaderFor(state, url);
  };

  const token = randomBytes(24).toString('hex');

  // Recorded security checks. Lives next to the FlowStore but conceptually
  // distinct — flows are *what the proxy saw*, checks are *what the agent
  // decided was a security assertion*. The Save-as-Security-spec path
  // reads this list. Cleared on `DELETE /checks` or `clear_flows` style
  // session reset.
  const checks: SecurityCheckStep[] = [];
  let nextCheckId = 1;
  const emitter = new EventEmitter();

  // Coverage gaps the agent reports — free-text notes of what it did NOT test
  // (out-of-scope areas, probe classes held back, anything only confirmable
  // out-of-band, surface it couldn't reach). Read into the findings report's
  // "Not tested" section. De-duplicated, trimmed, capped so a runaway agent
  // can't balloon the list.
  const gaps: string[] = [];
  const MAX_GAPS = 200;

  // Browser-confirmed findings — attacks the agent landed by driving the page
  // (reflected/DOM XSS, client-side injection, UI-level logic flaws) rather than
  // via replay_flow. Capped like gaps.
  const findings: BrowserFinding[] = [];
  let nextFindingId = 1;
  const MAX_FINDINGS = 200;

  const recordCheck = (raw: {
    sourceFlowId: string;
    replayFlow: Flow;
    intent: string;
    expectStatus: number;
    crossIdentity?: { identityB: string };
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
    const req = raw.replayFlow.request;
    const check: SecurityCheckStep = {
      id: nextCheckId++,
      sourceFlowId: raw.sourceFlowId,
      replayId: raw.replayFlow.id,
      intent: raw.intent,
      expectStatus: raw.expectStatus,
      request: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyText: req.bodyText,
      },
      ...(raw.crossIdentity ? { crossIdentity: raw.crossIdentity } : {}),
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

      if (req.method === 'GET' && path === '/coverage-gaps') {
        sendJson(res, 200, { gaps: [...gaps] });
        return;
      }

      if (req.method === 'POST' && path === '/coverage-gap') {
        const body = await readBody(req);
        let note = '';
        try {
          note = String((JSON.parse(body || '{}') as { note?: unknown }).note ?? '').trim();
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
        if (!note) {
          sendJson(res, 400, { error: 'note is required' });
          return;
        }
        // De-dup (agents repeat themselves) + cap. A duplicate counts as
        // recorded (idempotent); only a genuine cap-overflow is a failure the
        // agent must hear about (otherwise its tool prints "recorded" for a note
        // that was silently dropped).
        const gapAtCap = !gaps.includes(note) && gaps.length >= MAX_GAPS;
        if (!gaps.includes(note) && gaps.length < MAX_GAPS) gaps.push(note);
        sendJson(res, 200, {
          recorded: !gapAtCap,
          gaps: gaps.length,
          ...(gapAtCap ? { reason: 'coverage-gap cap reached' } : {}),
        });
        return;
      }

      if (req.method === 'GET' && path === '/findings') {
        sendJson(res, 200, { findings: [...findings] });
        return;
      }

      if (req.method === 'POST' && path === '/finding') {
        const body = await readBody(req);
        let p: { class?: unknown; intent?: unknown; severity?: unknown; evidence?: unknown; location?: unknown };
        try {
          p = JSON.parse(body || '{}') as typeof p;
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
        const intent = String(p.intent ?? '').trim();
        const evidence = String(p.evidence ?? '').trim();
        if (!intent || !evidence) {
          sendJson(res, 400, { error: 'intent and evidence are required' });
          return;
        }
        const sev = p.severity === 'High' || p.severity === 'Low' ? p.severity : 'Medium';
        // Only keep `class` when it's one of the known SecurityClass members —
        // an arbitrary agent-supplied string would otherwise be force-cast into
        // the closed union and corrupt downstream report/spec rendering.
        const cls =
          typeof p.class === 'string' && KNOWN_SECURITY_CLASSES.has(p.class as BrowserFinding['class'])
            ? (p.class as BrowserFinding['class'])
            : undefined;
        const findingAtCap = findings.length >= MAX_FINDINGS;
        if (!findingAtCap) {
          findings.push({
            id: nextFindingId++,
            class: cls,
            intent,
            severity: sev,
            evidence,
            location: typeof p.location === 'string' && p.location.trim() ? p.location.trim() : undefined,
            recordedAt: Date.now(),
          });
        }
        // Don't falsely confirm a finding that overflowed the cap — the agent
        // needs to know it vanished, not see "recorded".
        sendJson(res, 200, {
          recorded: !findingAtCap,
          findings: findings.length,
          ...(findingAtCap ? { reason: 'findings cap reached' } : {}),
        });
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

      if (req.method === 'GET' && path === '/suggest-probes') {
        // Match captured flows against the built-in probe seeds → the
        // "what's worth probing" list the agent acts on. store.list()
        // returns full flows (headers + body), which suggestProbes needs.
        // Security mode restricts to authz seeds via `seedCategories`.
        sendJson(res, 200, {
          suggestions: suggestProbes(store.list(), undefined, { categories: options.seedCategories }),
        });
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
          | (MutateOptions & { intent?: string; expectStatus?: number; as?: string })
          | undefined;
        try {
          const body = await readBody(req);
          if (body) parsed = JSON.parse(body);
        } catch (err) {
          sendJson(res, 400, { error: 'invalid JSON body', detail: String(err) });
          return;
        }
        const { intent, expectStatus, as, ...mutate } = parsed ?? {};

        // Replay AS a second identity: swap in that identity's cookies for the
        // request being replayed. This is how IDOR/BOLA is probed — issue
        // identity A's captured request with identity B's session.
        let crossIdentity: { identityB: string } | undefined;
        if (typeof as === 'string' && as.length > 0) {
          const srcUrl = mutate.url ?? store.get(id)?.request.url ?? '';
          const cookie = await identityCookie(as, srcUrl);
          if (typeof cookie !== 'string') {
            sendJson(res, 400, cookie);
            return;
          }
          mutate.headers = { ...(mutate.headers ?? {}), cookie };
          crossIdentity = { identityB: identities[as] };
        }

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
            crossIdentity,
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
        // Tell subscribers (the plugin → widget) the session was reset so the
        // widget's flows/checks state + badge don't go stale after clear_flows.
        emitter.emit('clear');
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
    listFindings: () => [...findings],
    listGaps: () => [...gaps],
    on: (event, listener) => {
      emitter.on(event, listener);
    },
    onClear: (listener) => {
      emitter.on('clear', listener);
    },
    async stop() {
      await new Promise<void>((res) => {
        server.close(() => res());
      });
    },
  };
}
