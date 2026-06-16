/**
 * Step 4 verification: from a vanilla WS client's perspective (i.e. what
 * the widget sees over the wire), the protocol additions for mode
 * toggle + flow broadcasting are right end-to-end.
 *
 * We don't drive Playwright / a real browser here. The widget JS is
 * exercised by visual inspection in `pnpm dev:example:basic-app`. This
 * script proves the wire protocol: connect → see modes catalogue with
 * security in it → set-mode security → mode broadcast lands → flows
 * generated through the proxy fan out as security:flow:added events
 * with the shape the widget's upsertFlow() expects.
 */
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startService } from '@hover-dev/core/service';
import { request as httpRequest } from 'node:http';
import securityMode from '../src/index.js';

const devRoot = mkdtempSync(join(tmpdir(), 'hover-widget-ws-smoke-'));
console.log('[widget-ws] devRoot =', devRoot);

const service = await startService({
  port: 51830,
  devRoot,
  plugins: [securityMode()],
});
console.log(`[widget-ws] service on :${service.port}`);

const ws = new WebSocket(`ws://127.0.0.1:${service.port}`);
const queue: { type: string; payload?: unknown }[] = [];
ws.on('message', (data) => {
  try {
    queue.push(JSON.parse(data.toString()));
  } catch {
    // ignore
  }
});
await new Promise<void>((res, rej) => {
  ws.once('open', () => res());
  ws.once('error', rej);
});

function waitFor<T>(
  predicate: (m: { type: string; payload?: unknown }) => boolean,
  label: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  return new Promise<T>((resolve, reject) => {
    const tick = (): void => {
      const idx = queue.findIndex(predicate);
      if (idx >= 0) {
        const [m] = queue.splice(idx, 1);
        resolve(m as T);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timeout waiting for ${label}`));
        return;
      }
      setTimeout(tick, 30);
    };
    tick();
  });
}

interface ModesMsg {
  type: 'modes';
  payload: {
    current: string | null;
    available: { id: string; label: string; description?: string; pluginName: string }[];
  };
}

// 1. Initial modes broadcast on connect
const initial = await waitFor<ModesMsg>((m) => m.type === 'modes', 'initial modes');
if (initial.payload.current !== null) throw new Error('expected current=null on first hello');
if (!initial.payload.available.some((m) => m.id === 'security')) {
  throw new Error('security mode missing from initial catalogue');
}
const sec = initial.payload.available.find((m) => m.id === 'security')!;
console.log(`[widget-ws] ✓ initial modes catalogue: current=null, includes "${sec.label}"`);
if (!sec.label || !sec.pluginName) throw new Error('mode entry missing label/pluginName');
console.log(`[widget-ws]   - label="${sec.label}"`);
console.log(`[widget-ws]   - description="${sec.description}"`);
console.log(`[widget-ws]   - pluginName="${sec.pluginName}"`);

// 2. set-mode 'security' produces mode broadcast with current='security'
ws.send(JSON.stringify({ type: 'set-mode', payload: { modeId: 'security' } }));
const activated = await waitFor<ModesMsg>(
  (m) =>
    m.type === 'modes' &&
    (m as { payload: { current: string | null } }).payload.current === 'security',
  'modes after activate',
);
void activated;
console.log('[widget-ws] ✓ set-mode security → modes broadcast with current=security');

// 3. Drive a flow through the proxy → check flow:added event
// mockttp picks the first free port in [8080, 8089]. To avoid probing it
// directly (which mockttp catches as a passthrough-loop and returns 500),
// just walk the candidate range and find the first that does NOT respond
// to a plain TCP connect — that's our cue the previous one is the proxy.
// Simpler: net.connect each; first that succeeds is the proxy.
import { createConnection } from 'node:net';
let proxyPort: number | null = null;
for (let p = 8080; p < 8090; p++) {
  const open = await new Promise<boolean>((res) => {
    const s = createConnection({ port: p, host: '127.0.0.1' });
    s.once('connect', () => {
      s.end();
      res(true);
    });
    s.once('error', () => res(false));
    setTimeout(() => res(false), 200);
  });
  if (open) {
    proxyPort = p;
    break;
  }
}
if (proxyPort == null) throw new Error('proxy port not found in [8080,8090)');
console.log(`[widget-ws] proxy detected on :${proxyPort}`);

await new Promise<void>((res, rej) => {
  const r = httpRequest(
    {
      host: '127.0.0.1',
      port: proxyPort!,
      method: 'GET',
      path: 'http://example.com/',
      headers: { host: 'example.com' },
    },
    (response) => {
      response.resume();
      response.on('end', () => res());
    },
  );
  r.on('error', rej);
  r.end();
});

// 4. Verify widget gets security:flow:added with the shape upsertFlow() needs
interface FlowMsg {
  type: 'security:flow:added';
  payload: {
    id: string;
    mutated: boolean;
    request: { method: string; url: string; httpVersion: string; bodyLen: number };
    response: null | { statusCode: number; bodyLen: number };
  };
}
const addEvt = await waitFor<FlowMsg>(
  (m) => m.type === 'security:flow:added',
  'security:flow:added',
  4000,
);
console.log(`[widget-ws] ✓ flow:added id=${addEvt.payload.id} url=${addEvt.payload.request.url}`);
if (!addEvt.payload.id || !addEvt.payload.request.method || !addEvt.payload.request.url) {
  throw new Error('flow:added payload missing required fields');
}

// 5. Verify widget gets security:flow:updated with the SAME id (upsert semantics)
const upEvt = await waitFor<FlowMsg>(
  (m) => m.type === 'security:flow:updated' && (m as FlowMsg).payload.id === addEvt.payload.id,
  'security:flow:updated for same id',
  4000,
);
const status = upEvt.payload.response?.statusCode;
console.log(`[widget-ws] ✓ flow:updated same id, status=${status}`);
if (status == null) throw new Error('updated payload missing response.statusCode');

// 6. set-mode null teardown
ws.send(JSON.stringify({ type: 'set-mode', payload: { modeId: null } }));
await waitFor<ModesMsg>(
  (m) =>
    m.type === 'modes' &&
    (m as { payload: { current: string | null } }).payload.current === null,
  'modes after deactivate',
);
console.log('[widget-ws] ✓ set-mode null → modes broadcast with current=null');

ws.close();
await service.close();
console.log('\n[widget-ws] PASS ✅');
process.exit(0);
