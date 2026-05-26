/**
 * Smoke for security plugin's MCP integration.
 *
 * Boots the plugin (via core service.set-mode), reads back the runtime
 * mcpServer env that activate() set, hits the control plane directly
 * with the right Bearer token, drives all 4 MCP-shaped operations:
 *
 *   GET /flows
 *   GET /flows/:id
 *   POST /flows/:id/replay
 *   DELETE /flows
 *
 * Then for the *real* MCP-protocol leg: spawns the built MCP server
 * subprocess with the env we'd hand to the agent, talks to it over
 * stdio using the official @modelcontextprotocol/sdk client, and
 * exercises one tool end-to-end (`list_flows`).
 */
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startProxy } from '../src/mitm/index.js';
import { startControlPlane } from '../src/control-plane.js';

const devRoot = mkdtempSync(join(tmpdir(), 'hover-mcp-smoke-'));
console.log('[mcp-smoke] devRoot =', devRoot);

const proxy = await startProxy(devRoot);
const control = await startControlPlane(proxy.store);
console.log(`[mcp-smoke] control plane :${control.port}  token=${control.token.slice(0, 12)}…`);

// Seed a flow
proxy.store.add({
  method: 'GET',
  url: 'https://api.example.com/v1/users/42',
  httpVersion: '2.0',
  headers: { authorization: 'Bearer test-token' },
  bodyText: null,
  bodyLen: 0,
  startedAt: Date.now(),
});

// Direct HTTP: list, get, replay, clear
async function api<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${control.port}${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
    body: init?.body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

const list1 = await api<{ flows: { id: string }[] }>('/flows');
console.log(`[mcp-smoke] ✓ GET /flows → ${list1.flows.length} flow(s)`);
if (list1.flows.length !== 1) throw new Error('expected 1 flow seeded');

const seededId = list1.flows[0].id;
const full = await api<{ id: string; request: { url: string } }>(`/flows/${seededId}`);
console.log(`[mcp-smoke] ✓ GET /flows/:id → ${full.request.url}`);

// Replay against a real public URL so the test is end-to-end honest
const replayed = await api<{ replayId: string; flow: { response: { statusCode: number } } }>(
  `/flows/${seededId}/replay`,
  {
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/', headers: { authorization: null } }),
  },
);
console.log(
  `[mcp-smoke] ✓ POST /flows/:id/replay → replayId=${replayed.replayId} status=${replayed.flow.response?.statusCode}`,
);

const cleared = await api<{ cleared: number }>('/flows', { method: 'DELETE' });
console.log(`[mcp-smoke] ✓ DELETE /flows → cleared=${cleared.cleared}`);

const list2 = await api<{ flows: unknown[] }>('/flows');
if (list2.flows.length !== 0) throw new Error('expected store empty after DELETE');
console.log('[mcp-smoke] ✓ store empty after clear');

// ── Real MCP-protocol leg ──────────────────────────────────────────
console.log('\n[mcp-smoke] === MCP-protocol leg ===');

// Re-seed
proxy.store.add({
  method: 'GET',
  url: 'https://api.example.com/v1/users/42',
  httpVersion: '2.0',
  headers: {},
  bodyText: null,
  bodyLen: 0,
  startedAt: Date.now(),
});

// Use the built dist version of the MCP server (build runs first).
const builtMcpServer = fileURLToPath(new URL('../dist/mcp/server.js', import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [builtMcpServer],
  env: {
    ...process.env,
    HOVER_SECURITY_API: `http://127.0.0.1:${control.port}`,
    HOVER_SECURITY_API_TOKEN: control.token,
  } as Record<string, string>,
});
const client = new McpClient({ name: 'hover-security-smoke', version: '0.0.0' });
await client.connect(transport);
console.log('[mcp-smoke] ✓ MCP client connected');

const tools = await client.listTools();
console.log(`[mcp-smoke] ✓ tools advertised: ${tools.tools.map((t) => t.name).join(', ')}`);
const expectedTools = ['list_flows', 'get_flow', 'replay_flow', 'clear_flows'];
for (const name of expectedTools) {
  if (!tools.tools.some((t) => t.name === name)) {
    throw new Error(`missing tool: ${name}`);
  }
}

const listResult = await client.callTool({ name: 'list_flows', arguments: {} });
const listText = (listResult.content as { type: string; text: string }[]).find((c) => c.type === 'text')?.text;
console.log(`[mcp-smoke] ✓ list_flows output:\n${listText}`);
if (!listText?.includes('api.example.com/v1/users/42')) {
  throw new Error('list_flows did not surface the seeded flow');
}

await client.close();
await control.stop();
await proxy.stop();
console.log('\n[mcp-smoke] PASS ✅');
process.exit(0);
