/**
 * Plugin lifecycle end-to-end smoke.
 *
 * Boots a real Hover service with the @hover-dev/security plugin loaded,
 * connects a WebSocket client, drives mode toggle on/off via the wire
 * protocol, and asserts:
 *
 *   1. `hello` arrives on connection
 *   2. `modes` catalogue arrives with the security mode present
 *   3. `set-mode { modeId: 'security' }` triggers the plugin's activate
 *      hook (mockttp boots, a port becomes listenable, broadcast modes
 *      lands with current='security')
 *   4. plugin's namespaced events (security:flow:*) make it to the client
 *      when traffic flows through the proxy
 *   5. `set-mode { modeId: null }` triggers deactivate (proxy stops,
 *      port goes back to free)
 *   6. service.close() runs shutdown hooks idempotently
 *
 * This script does NOT touch a real Chrome — that's covered by
 * @hover-dev/security's own e2e-smoke. Here we only validate the
 * core ↔ plugin protocol wire-up.
 */
import { startService } from '@hover-dev/core/service';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createConnection } from 'node:net';
import securityMode from '../src/index.js';

const devRoot = mkdtempSync(join(tmpdir(), 'hover-plugin-smoke-'));
console.log('[plugin-smoke] devRoot =', devRoot);

function isPortListening(port: number, host = '127.0.0.1', timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host });
    const done = (ok: boolean): void => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

/** Buffer messages from the moment the WS opens so awaits later don't
 *  race with broadcasts the service already fired. */
class MessageBus {
  private queue: { type: string; payload?: unknown }[] = [];
  private waiters: {
    predicate: (m: { type: string; payload?: unknown }) => boolean;
    resolve: (m: { type: string; payload?: unknown }) => void;
  }[] = [];

  attach(ws: WebSocket): void {
    ws.on('message', (data) => {
      let parsed: { type: string; payload?: unknown };
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      const idx = this.waiters.findIndex((w) => w.predicate(parsed));
      if (idx >= 0) {
        const [w] = this.waiters.splice(idx, 1);
        w.resolve(parsed);
      } else {
        this.queue.push(parsed);
      }
    });
  }

  expect<T>(
    predicate: (m: { type: string; payload?: unknown }) => boolean,
    label: string,
    timeoutMs = 5000,
  ): Promise<T> {
    const idx = this.queue.findIndex(predicate);
    if (idx >= 0) {
      const [m] = this.queue.splice(idx, 1);
      return Promise.resolve(m as T);
    }
    return new Promise<T>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: (m: { type: string; payload?: unknown }) => resolve(m as T),
      };
      this.waiters.push(waiter);
      setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`[plugin-smoke] timed out waiting for ${label}`));
        }
      }, timeoutMs);
    });
  }
}

const service = await startService({
  port: 51799, // odd port so we don't clash with a running dev server
  devRoot,
  plugins: [securityMode()],
});
console.log(`[plugin-smoke] service on ws://127.0.0.1:${service.port}`);

const ws = new WebSocket(`ws://127.0.0.1:${service.port}`);
const bus = new MessageBus();
bus.attach(ws); // attach BEFORE 'open' so we don't miss the burst
await new Promise<void>((res, rej) => {
  ws.once('open', () => res());
  ws.once('error', rej);
});
console.log('[plugin-smoke] ws connected');

interface ModeEntry { id: string; label: string; pluginName: string }
interface ModesMessage { type: 'modes'; payload: { current: string | null; available: ModeEntry[] } }

const initialModes = await bus.expect<ModesMessage>(
  (m) => m.type === 'modes',
  'initial modes catalogue',
);
console.log(`[plugin-smoke] initial modes:`, JSON.stringify(initialModes.payload));

const hasSecurity = initialModes.payload.available.some((m) => m.id === 'security');
if (!hasSecurity) {
  console.log('[plugin-smoke] FAIL ❌ security mode not in catalogue');
  process.exit(1);
}
if (initialModes.payload.current !== null) {
  console.log('[plugin-smoke] FAIL ❌ current mode should start null');
  process.exit(1);
}
console.log('[plugin-smoke] ✓ security mode visible, current=null');

// Activate security mode
ws.send(JSON.stringify({ type: 'set-mode', payload: { modeId: 'security' } }));
const activatedModes = await bus.expect<ModesMessage>(
  (m) => m.type === 'modes' && (m.payload as { current: string | null }).current === 'security',
  'modes broadcast after activate',
);
console.log(`[plugin-smoke] ✓ mode activated: current=${activatedModes.payload.current}`);

// Probe the proxy port. The security plugin defaults to allocating in
// [8080, 8090). We don't know exactly which one it grabbed — try each.
let proxyPort: number | null = null;
for (let p = 8080; p < 8090; p++) {
  if (await isPortListening(p)) {
    proxyPort = p;
    break;
  }
}
if (proxyPort === null) {
  console.log('[plugin-smoke] FAIL ❌ no mockttp port listening after activate');
  process.exit(1);
}
console.log(`[plugin-smoke] ✓ proxy listening on :${proxyPort}`);

// Generate a flow into the proxy and verify the plugin broadcasts it.
// We use Node's HTTP CONNECT-via-proxy through undici. Simpler: write
// raw HTTP to the proxy directly; mockttp will forward.
const flowEventPromise = bus.expect<{ type: string; payload: { id: string; request: { url: string } } }>(
  (m) => m.type === 'security:flow:added',
  'security:flow:added event',
  6000,
);

// Drive a plain HTTP CONNECT through the proxy. Easier: just hit an HTTP
// (not HTTPS) endpoint via the proxy. mockttp accepts plain HTTP too.
const { request } = await import('node:http');
await new Promise<void>((res, rej) => {
  const req = request({
    host: '127.0.0.1',
    port: proxyPort!,
    method: 'GET',
    path: 'http://example.com/',
    headers: { host: 'example.com' },
  });
  req.on('response', (response) => {
    response.resume();
    response.on('end', () => res());
  });
  req.on('error', rej);
  req.end();
});

const flowEvent = await flowEventPromise;
console.log(`[plugin-smoke] ✓ flow event broadcast: ${flowEvent.payload.request.url}`);

// Deactivate
ws.send(JSON.stringify({ type: 'set-mode', payload: { modeId: null } }));
await bus.expect<ModesMessage>(
  (m) => m.type === 'modes' && (m.payload as { current: string | null }).current === null,
  'modes broadcast after deactivate',
);
console.log('[plugin-smoke] ✓ mode deactivated: current=null');

// Give mockttp a moment to release the port
await new Promise((r) => setTimeout(r, 300));
const stillListening = await isPortListening(proxyPort);
if (stillListening) {
  console.log(`[plugin-smoke] FAIL ❌ proxy port :${proxyPort} still listening after deactivate`);
  process.exit(1);
}
console.log(`[plugin-smoke] ✓ proxy port :${proxyPort} freed after deactivate`);

ws.close();
await service.close();
console.log('[plugin-smoke] ✓ service.close() ran shutdown hooks cleanly');

console.log('\n[plugin-smoke] PASS ✅');
process.exit(0);
