/**
 * Smoke test for @hover-dev/api-test mitm internals.
 *
 * - boots the proxy in a tmp devRoot, confirms it binds + emits the lifecycle
 * - manually pushes a synthetic request into the FlowStore, confirms events
 * - replays it with a header mutation against a real public URL
 *
 * The "real Chrome through the proxy" leg is in e2e-smoke.ts.
 */
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { startProxy, replayFlow, type FlowEvent } from '../src/mitm/index.js';

const devRoot = mkdtempSync(join(tmpdir(), 'hover-mitm-smoke-'));
console.log('[smoke] devRoot =', devRoot);

const handle = await startProxy(devRoot);
console.log(`[smoke] proxy on :${handle.port}  SPKI=${handle.ca.spki}`);

const events: FlowEvent[] = [];
handle.store.on('event', (e: FlowEvent) => {
  events.push(e);
  console.log(
    `[smoke] ${e.type}  ${e.flow.id}  ${e.flow.request.method} ${e.flow.request.url}` +
      (e.flow.response ? `  → ${e.flow.response.statusCode}` : ''),
  );
});

// Pretend mockttp saw a GET — manually push through the FlowStore.
const seedFlow = handle.store.add({
  method: 'GET',
  url: 'https://example.com/',
  httpVersion: '2.0',
  headers: { 'user-agent': 'hover-smoke' },
  bodyText: null,
  bodyLen: 0,
  startedAt: Date.now(),
});

// Replay it for real against the live server with one header override.
const result = await replayFlow(handle.store, seedFlow.id, {
  headers: { 'x-hover-mutated': 'yes' },
});

if ('error' in result) {
  console.log('[smoke] replay error', result.error);
  process.exit(1);
}

const replay = handle.store.get(result.replayId);
const replayOk =
  replay?.response?.statusCode === 200 &&
  (replay?.response?.bodyText?.includes('Example Domain') ?? false);

console.log(`\n[smoke] FlowStore size: ${handle.store.list().length}`);
console.log(`[smoke] events captured: ${events.length}`);
console.log(`[smoke] replay status:   ${replay?.response?.statusCode}`);
console.log(`[smoke] replay body OK:  ${replayOk}`);

await handle.stop();
console.log(replayOk ? '\n[smoke] PASS ✅' : '\n[smoke] FAIL ❌');
process.exit(replayOk ? 0 : 1);
