#!/usr/bin/env node
/**
 * @hover-dev/security MCP server.
 *
 * Spawned by the agent (Claude Code / Codex) as a stdio subprocess when
 * security mode is active. Talks back to the plugin's control plane over
 * loopback HTTP. The control plane URL + auth token come in via env:
 *
 *   HOVER_SECURITY_API        e.g. "http://127.0.0.1:51850"
 *   HOVER_SECURITY_API_TOKEN  process-random Bearer token
 *
 * Tools exposed to the agent:
 *
 *   list_flows()                                → summaries (no bodies)
 *   get_flow({ id })                            → full flow incl. body
 *   replay_flow({ id, method?, url?, headers?, bodyText? })
 *                                               → replayed flow
 *   clear_flows()                               → drop all captured flows
 *
 * Output is human-readable Markdown so the agent can dump tool results
 * into its scratchpad without parsing JSON shapes.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const apiBase = process.env.HOVER_SECURITY_API;
const apiToken = process.env.HOVER_SECURITY_API_TOKEN;
if (!apiBase || !apiToken) {
  process.stderr.write(
    '[hover-security-mcp] HOVER_SECURITY_API and HOVER_SECURITY_API_TOKEN must be set by the host plugin.\n',
  );
  process.exit(1);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path}${body ? `: ${body}` : ''}`);
  }
  return (await res.json()) as T;
}

interface FlowSummary {
  id: string;
  mutated: boolean;
  request: { method: string; url: string; httpVersion: string; startedAt: number; bodyLen: number };
  response: { statusCode: number; statusMessage?: string; completedAt: number; bodyLen: number } | null;
}

interface FullFlow {
  id: string;
  mutated: boolean;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Record<string, string | string[] | undefined>;
    bodyText: string | null;
    bodyLen: number;
    startedAt: number;
  };
  response?: {
    statusCode: number;
    statusMessage?: string;
    headers: Record<string, string | string[] | undefined>;
    bodyText: string | null;
    bodyLen: number;
    completedAt: number;
  };
}

function md(text: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text }] };
}

function summarizeFlow(f: FlowSummary): string {
  const r = f.request;
  const s = f.response;
  const status = s ? `${s.statusCode} ${s.statusMessage ?? ''}`.trim() : 'pending';
  const mutMark = f.mutated ? ' [MUTATED]' : '';
  return `- \`${f.id}\` h${r.httpVersion} ${r.method} ${r.url} → ${status} (${s?.bodyLen ?? 0}b)${mutMark}`;
}

function renderHeaders(h: Record<string, string | string[] | undefined>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    const val = Array.isArray(v) ? v.join(', ') : v;
    lines.push(`${k}: ${val}`);
  }
  return lines.join('\n');
}

function truncate(s: string | null, n = 2000): string {
  if (s == null) return '(binary or empty)';
  if (s.length <= n) return s;
  return `${s.slice(0, n)}\n… (${s.length - n} more chars truncated)`;
}

const server = new McpServer({
  name: 'hover-security',
  version: '0.0.0',
});

server.registerTool(
  'list_flows',
  {
    description:
      'List captured HTTP flows from the current debug Chrome session. Returns short summaries (id, method, url, status, body length, mutation marker). Use `get_flow` to fetch a single flow with full headers and body.',
    inputSchema: {},
  },
  async () => {
    const { flows } = await api<{ flows: FlowSummary[] }>('/flows');
    if (flows.length === 0) {
      return md(
        'No flows captured yet. Drive the browser (login, click around, submit a form) to populate the proxy.',
      );
    }
    const lines = flows.map(summarizeFlow);
    return md(`Captured ${flows.length} flow(s):\n${lines.join('\n')}`);
  },
);

server.registerTool(
  'get_flow',
  {
    description:
      'Get the full request and response (headers + body) for one flow id. Use the ids returned by `list_flows`.',
    inputSchema: { id: z.string().describe('Flow id (hex). Get one from list_flows.') },
  },
  async ({ id }) => {
    const flow = await api<FullFlow>(`/flows/${encodeURIComponent(id)}`);
    const out: string[] = [];
    out.push(`# Flow ${flow.id}${flow.mutated ? ' [MUTATED]' : ''}\n`);
    out.push(`## Request\n\`\`\`http`);
    out.push(`${flow.request.method} ${flow.request.url} HTTP/${flow.request.httpVersion}`);
    out.push(renderHeaders(flow.request.headers));
    if (flow.request.bodyText) {
      out.push('');
      out.push(truncate(flow.request.bodyText));
    }
    out.push('```');
    if (flow.response) {
      out.push(`\n## Response\n\`\`\`http`);
      out.push(`HTTP ${flow.response.statusCode} ${flow.response.statusMessage ?? ''}`.trim());
      out.push(renderHeaders(flow.response.headers));
      if (flow.response.bodyText) {
        out.push('');
        out.push(truncate(flow.response.bodyText));
      }
      out.push('```');
    } else {
      out.push('\n_(response not yet received)_');
    }
    return md(out.join('\n'));
  },
);

server.registerTool(
  'replay_flow',
  {
    description:
      'Replay a captured flow against the real server, optionally mutating method, URL, headers, or body. The replayed flow is added to the store as a NEW flow with its own id (returned). Use this to probe for IDOR (mutate the resource id in the URL), parameter tampering (rewrite request body), or authorization bypass (drop or swap the auth header). Always check the response status: 200 OK to a mutated request often indicates the server accepted unauthorized input.',
    inputSchema: {
      id: z.string().describe('Source flow id from list_flows.'),
      method: z.string().optional().describe('Override HTTP method (e.g. switch GET to DELETE).'),
      url: z.string().optional().describe('Override request URL — typical IDOR test.'),
      headers: z
        .record(z.string(), z.union([z.string(), z.null()]))
        .optional()
        .describe('Header overrides. Value null deletes the header. Case-insensitive.'),
      bodyText: z.string().optional().describe('Replace the request body with this UTF-8 string.'),
    },
  },
  async ({ id, method, url, headers, bodyText }) => {
    const mutate = { method, url, headers, bodyText };
    const result = await api<{ replayId: string; flow: FullFlow }>(
      `/flows/${encodeURIComponent(id)}/replay`,
      { method: 'POST', body: JSON.stringify(mutate) },
    );
    const f = result.flow;
    const r = f.request;
    const s = f.response;
    const out: string[] = [];
    out.push(`Replayed as flow \`${result.replayId}\`.\n`);
    out.push(`${r.method} ${r.url}`);
    out.push(`→ ${s ? `${s.statusCode} ${s.statusMessage ?? ''}` : 'no response'}`);
    if (s?.bodyText) {
      out.push(`\n\`\`\``);
      out.push(truncate(s.bodyText, 1000));
      out.push(`\`\`\``);
    }
    return md(out.join('\n'));
  },
);

server.registerTool(
  'clear_flows',
  {
    description:
      'Drop every captured flow from the proxy store. Use between separate probe rounds to keep `list_flows` output focused.',
    inputSchema: {},
  },
  async () => {
    const { cleared } = await api<{ cleared: number }>('/flows', { method: 'DELETE' });
    return md(`Cleared ${cleared} flow(s).`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[hover-security-mcp] connected (api=${apiBase})\n`);
