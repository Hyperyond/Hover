/**
 * Step 6 smoke: when a plugin contributes MCP servers and its mode is
 * active, the agent's generated mcp-config JSON contains those servers
 * with the runtime env the plugin's activate() set.
 *
 * We don't actually invoke an agent — that would require Claude/Codex
 * installed + Chrome on CDP. We do the lighter check: boot the service
 * with securityMode loaded, drive set-mode 'security' over WS to fire
 * activate(), then issue a fake `command` so the service walks its
 * code path. invokeAgent will fail without an agent CLI, but BEFORE
 * failing it has already written the mcp-config file we care about
 * to <tmpdir>/hover/mcp-config-<port>-security.json. We read that file
 * and assert it has both the playwright entry AND our hover-security
 * entry with the right env.
 *
 * This is a "white-box" assertion that the wiring works without needing
 * the real agent in the loop.
 */
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startService } from '@hover-dev/core/service';
import securityMode from '../src/index.js';

const devRoot = mkdtempSync(join(tmpdir(), 'hover-agentcfg-smoke-'));
console.log('[agent-cfg] devRoot =', devRoot);

const service = await startService({
  port: 51820,
  devRoot,
  // Force preflight failure: point at a port that's guaranteed not to host CDP.
  // Without this, an unrelated debug Chrome on :9222 (e.g. one left behind by
  // `pnpm dev:example:basic-app`) makes preflight succeed and the smoke
  // proceeds to actually spawn claude — which blocks until the run finishes
  // or the budget runs out. We only want to verify the mcp-config writeout,
  // not exercise the agent itself.
  cdpUrl: 'http://127.0.0.1:1',
  plugins: [securityMode()],
});
console.log(`[agent-cfg] service on :${service.port}`);

const ws = new WebSocket(`ws://127.0.0.1:${service.port}`);
await new Promise<void>((res, rej) => {
  ws.once('open', () => res());
  ws.once('error', rej);
});

// Buffer messages from the moment we open so set-mode broadcast doesn't
// race with us.
const queue: { type: string; payload?: unknown }[] = [];
ws.on('message', (data) => {
  try {
    queue.push(JSON.parse(data.toString()));
  } catch {
    // ignore non-JSON
  }
});
function waitFor(predicate: (m: { type: string }) => boolean, timeoutMs = 5000): Promise<{ type: string; payload?: unknown }> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const idx = queue.findIndex(predicate);
      if (idx >= 0) {
        const [m] = queue.splice(idx, 1);
        resolve(m);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timeout'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

ws.send(JSON.stringify({ type: 'set-mode', payload: { modeId: 'security' } }));
await waitFor(
  (m) =>
    m.type === 'modes' &&
    (m as { payload: { current: string | null } }).payload.current === 'security',
);
console.log('[agent-cfg] ✓ security mode activated');

// Now drive a fake command. invokeAgent will throw because there's no
// CDP listener, but we don't actually need it to succeed — the
// mcp-config file is written before invokeAgent runs.
ws.send(JSON.stringify({ type: 'command', payload: { text: 'noop' } }));
// Wait for session_end (the failure that confirms the code path reached
// invokeAgent — which means buildMcpConfig was already called).
const sessionEnd = await waitFor(
  (m) =>
    m.type === 'event' &&
    (m as { payload: { kind: string } }).payload.kind === 'session_end',
  10000,
);
console.log(`[agent-cfg] ✓ session_end seen (cdp preflight failed as expected)`);
void sessionEnd;

// Now look at the file. Suffix is 'security'.
const configPath = join(tmpdir(), 'hover', `mcp-config-${service.port}-security.json`);
if (!existsSync(configPath)) {
  console.log(`[agent-cfg] FAIL ❌ mcp-config file missing at ${configPath}`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
};
console.log(`[agent-cfg] config keys:`, Object.keys(config.mcpServers).join(', '));

if (!config.mcpServers.playwright) {
  console.log('[agent-cfg] FAIL ❌ playwright entry missing');
  process.exit(1);
}
console.log('[agent-cfg] ✓ playwright entry present');

const securityEntry = config.mcpServers['@hover-dev/api-test:flows'];
if (!securityEntry) {
  console.log('[agent-cfg] FAIL ❌ @hover-dev/api-test:flows entry missing');
  process.exit(1);
}
console.log('[agent-cfg] ✓ security MCP entry present');

if (!securityEntry.env?.HOVER_SECURITY_API?.startsWith('http://127.0.0.1:')) {
  console.log(
    `[agent-cfg] FAIL ❌ HOVER_SECURITY_API env not set correctly (got: ${securityEntry.env?.HOVER_SECURITY_API})`,
  );
  process.exit(1);
}
console.log(`[agent-cfg] ✓ HOVER_SECURITY_API=${securityEntry.env.HOVER_SECURITY_API}`);

if (!securityEntry.env?.HOVER_SECURITY_API_TOKEN || securityEntry.env.HOVER_SECURITY_API_TOKEN.length < 16) {
  console.log('[agent-cfg] FAIL ❌ HOVER_SECURITY_API_TOKEN missing or too short');
  process.exit(1);
}
console.log(`[agent-cfg] ✓ HOVER_SECURITY_API_TOKEN set (${securityEntry.env.HOVER_SECURITY_API_TOKEN.length} chars)`);

if (!securityEntry.command || !securityEntry.args?.[0]?.endsWith('server.js')) {
  console.log(`[agent-cfg] FAIL ❌ command/args not pointing at server.js: ${securityEntry.command} ${securityEntry.args?.join(' ')}`);
  process.exit(1);
}
console.log(`[agent-cfg] ✓ command=${securityEntry.command} args=[…${securityEntry.args[0].slice(-25)}]`);

// Toggle off
ws.send(JSON.stringify({ type: 'set-mode', payload: { modeId: null } }));
await waitFor(
  (m) =>
    m.type === 'modes' &&
    (m as { payload: { current: string | null } }).payload.current === null,
);
console.log('[agent-cfg] ✓ mode deactivated');

ws.close();
await service.close();
console.log('\n[agent-cfg] PASS ✅');
process.exit(0);
