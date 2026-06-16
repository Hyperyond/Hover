#!/usr/bin/env node
/**
 * @hover-dev/api-test MCP server.
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
 *   adjudicate_bola({ baselineFlowId, attackFlowId, referenceFlowId, … })
 *                                               → BOLA verdict (three-way oracle)
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
  'record_coverage_gap',
  {
    description:
      'Record something you did NOT test, and why. Call this once per gap, in plain language: an area you skipped (out of scope, or you ran out of session), a probe class you held back, anything only confirmable out-of-band (forbidden here — note it as SUSPECTED, not confirmed), or surface you could not reach (auth wall, missing test data, flaky UI). These notes become the findings report\'s "Not tested" section, so the report is honest about coverage. Treat untested surface as UNKNOWN, never as safe.',
    inputSchema: {
      note: z
        .string()
        .describe(
          'One coverage gap — what you did not test and why. e.g. "the /admin area — out of scope" or "blind SSRF on /webhook — only confirmable out-of-band, left as suspected".',
        ),
    },
  },
  async ({ note }) => {
    const r = await api<{ recorded: boolean; gaps: number; reason?: string }>('/coverage-gap', {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    if (!r.recorded) return md(`⚠ Coverage gap NOT recorded (${r.reason ?? 'rejected'}): ${note}`);
    return md(`📝 Coverage gap recorded (${r.gaps} total): ${note}`);
  },
);

server.registerTool(
  'record_finding',
  {
    description:
      'Record a vulnerability you CONFIRMED by driving the browser — reflected / DOM XSS you watched execute, a client-side injection, a UI-level auth or logic flaw you triggered. Use `replay_flow` (with intent + expectStatus) for HTTP-level probes like IDOR / mass-assignment; use THIS for anything you confirmed in the page itself, which produces no replayed request. Both feed the findings report — a browser attack you DON\'T record here will NOT appear in the report. Only record what you actually confirmed in-band; put the payload you sent + the effect you observed in `evidence`, and never include real user data.',
    inputSchema: {
      intent: z.string().describe('Short description, e.g. "Reflected XSS in the search field".'),
      evidence: z
        .string()
        .describe('What you sent + what you observed, in-band. e.g. "typed <script>alert(1)</script> into ?q= ; it reflected unencoded and the alert fired".'),
      class: z
        .string()
        .optional()
        .describe('Vulnerability class when known: xss / sqli / ssti / open-redirect / idor / csrf / …'),
      severity: z.enum(['High', 'Medium', 'Low']).optional().describe('Your severity assessment. Defaults to Medium.'),
      location: z.string().optional().describe('Page URL / field where it lives, sanitized (no tokens).'),
    },
  },
  async ({ intent, evidence, class: cls, severity, location }) => {
    const r = await api<{ recorded: boolean; findings: number; reason?: string }>('/finding', {
      method: 'POST',
      body: JSON.stringify({ intent, evidence, class: cls, severity, location }),
    });
    if (!r.recorded) return md(`⚠ Finding NOT recorded (${r.reason ?? 'rejected'}): ${intent}`);
    return md(`🎯 Finding recorded (${r.findings} total): [${severity ?? 'Medium'}] ${intent}`);
  },
);

interface ProbeSuggestion {
  flowId: string;
  method: string;
  url: string;
  class: string;
  seed: string;
  strategy: string;
  signal: string;
}

server.registerTool(
  'suggest_probes',
  {
    description:
      'Scan the captured flows for access-control probe candidates (IDOR / BFLA / mass-assignment / SSRF / auth-bypass). Returns, per matching flow, what to try and what a real finding looks like. Start here, then use get_flow + replay_flow to probe a candidate.',
    inputSchema: {},
  },
  async () => {
    const { suggestions } = await api<{ suggestions: ProbeSuggestion[] }>('/suggest-probes');
    if (suggestions.length === 0) {
      return md(
        'No probe candidates yet. Drive the app (log in, open a record, submit a form) so the proxy captures authenticated requests, then re-run.',
      );
    }
    const lines = suggestions.map(
      (s) =>
        `- \`${s.flowId}\` **${s.class}** — ${s.method} ${s.url}\n` +
        `  - try: ${s.strategy}\n` +
        `  - finding: ${s.signal}`,
    );
    return md(`${suggestions.length} probe candidate(s):\n${lines.join('\n')}`);
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
      'Replay a captured flow against the real server, optionally mutating method, URL, headers, or body. The replayed flow is added to the store as a NEW flow with its own id (returned). Use this to probe for IDOR (mutate the resource id in the URL), parameter tampering (rewrite request body), or authorization bypass (drop or swap the auth header). Always check the response status: 200 OK to a mutated request often indicates the server accepted unauthorized input. The replay is gated to the source flow\'s origin by default — set allowCrossOrigin only when the user has explicitly authorised testing the third-party target.\n\nv0.12: pass `intent` (one-line human description, e.g. "IDOR: access another user\'s order") and `expectStatus` (the status code that proves the control works, e.g. 403) together to RECORD this replay as a security check. Recorded checks accumulate across the session; the user can then "Save as Security spec" to crystallise them into a Playwright regression spec that runs in CI without any agent in the loop. Always supply both intent and expectStatus when you\'re probing for a known vulnerability class — without them the replay still works but isn\'t recordable.',
    inputSchema: {
      id: z.string().describe('Source flow id from list_flows.'),
      method: z.string().optional().describe('Override HTTP method (e.g. switch GET to DELETE).'),
      url: z.string().optional().describe('Override request URL — typical IDOR test.'),
      headers: z
        .record(z.string(), z.union([z.string(), z.null()]))
        .optional()
        .describe('Header overrides. Value null deletes the header. Case-insensitive.'),
      bodyText: z.string().optional().describe('Replace the request body with this UTF-8 string.'),
      allowCrossOrigin: z
        .boolean()
        .optional()
        .describe(
          'Set true to allow replaying against an origin different from the source flow. Off by default to prevent accidental probes of third-party APIs (Stripe, Sentry, analytics). Only set when the user has explicitly authorised the target.',
        ),
      intent: z
        .string()
        .optional()
        .describe(
          'One-line human description of what security property this replay tests. Examples: "IDOR: access another user\'s order", "Authz: missing token still allows write", "Parameter tampering: alter price field". When present (with expectStatus), the replay is RECORDED as a security check that can be crystallised into a regression spec.',
        ),
      expectStatus: z
        .number()
        .optional()
        .describe(
          'HTTP status code that proves the security control is working. Example: probing IDOR by changing /orders/me → /orders/999, expectStatus is 403 (the server SHOULD reject the cross-user lookup). When this matches the observed status, the check is recorded as a verified control; when it doesn\'t, the check is recorded as a vulnerability finding.',
        ),
      as: z
        .string()
        .optional()
        .describe(
          'Replay AS a second identity — the label of a storageState configured in securityMode({ identities }). This is the core IDOR/BOLA test: issue identity A\'s captured request with identity B\'s session. B\'s cookies override the captured ones. A recorded check then crystallises into a multi-role browser.newContext({ storageState }) spec. Example: as: "userB" with expectStatus 403 — B must NOT reach A\'s resource.',
        ),
    },
  },
  async ({ id, method, url, headers, bodyText, allowCrossOrigin, intent, expectStatus, as }) => {
    const payload = { method, url, headers, bodyText, allowCrossOrigin, intent, expectStatus, as };
    const result = await api<{
      replayId: string;
      flow: FullFlow;
      check?: { id: number; intent: string; expectStatus: number; matched: boolean };
    }>(
      `/flows/${encodeURIComponent(id)}/replay`,
      { method: 'POST', body: JSON.stringify(payload) },
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
    if (result.check) {
      out.push('');
      out.push(
        `🔒 **Security check recorded** (#${result.check.id}): ${result.check.intent}`,
      );
      out.push(
        result.check.matched
          ? `   ✓ Observed ${s?.statusCode ?? '?'} matches expected ${result.check.expectStatus}. Control is in place.`
          : `   ✗ Observed ${s?.statusCode ?? '?'} ≠ expected ${result.check.expectStatus}. **Potential vulnerability.** Include this in your Findings + recommend "Save as Security spec" so the regression is caught in CI.`,
      );
    } else if (intent || expectStatus) {
      out.push('');
      out.push(
        `_(Not recorded as a check — both \`intent\` and \`expectStatus\` are required together.)_`,
      );
    }
    return md(out.join('\n'));
  },
);

server.registerTool(
  'adjudicate_bola',
  {
    description:
      'Adjudicate a BOLA / object-level authorization test with the three-way judgment oracle — the deterministic way to decide whether a 2xx to a cross-object request is an ACTUAL data leak vs. public data vs. a soft denial (200 + empty body). Gather three flows first, then call this:\n' +
      '  • baselineFlowId — R(A,objA): identity A reading A\'s OWN object (usually the original captured flow). Establishes A\'s normal view.\n' +
      '  • attackFlowId — R(A,objB): identity A reading B\'s object (replay the captured request with the object id mutated to B\'s). The attack under test.\n' +
      '  • referenceFlowId — R(B,objB): identity B reading B\'s own object (replay `as` B with B\'s object id, or a captured B flow). Establishes what B\'s data looks like.\n' +
      'Pass bMarkers = B\'s identifying tokens that must NOT appear in A\'s response (B\'s object id, primary key, email). Pass attachToCheckId to attach the verdict to a recorded check — ONLY a `confirmed` verdict crystallizes into a security spec; likely/uncertain stay report-only. Prefer this over eyeballing the status code: status alone causes false positives on soft denials.',
    inputSchema: {
      baselineFlowId: z.string().describe('R(A,objA) flow id — A reading A\'s own object (often the original captured flow).'),
      attackFlowId: z.string().describe('R(A,objB) flow id — A reading B\'s object (replay with the object id swapped to B\'s).'),
      referenceFlowId: z.string().describe('R(B,objB) flow id — B reading B\'s own object (replay as B, or a captured B flow).'),
      bMarkers: z
        .array(z.string())
        .optional()
        .describe('B\'s identifying tokens that must not leak to A: B\'s object id, primary key, email, etc.'),
      attachToCheckId: z
        .number()
        .optional()
        .describe('Recorded check id (from a replay_flow with intent+expectStatus) to attach this verdict to. Gates crystallization — only a `confirmed` verdict becomes a spec.'),
    },
  },
  async ({ baselineFlowId, attackFlowId, referenceFlowId, bMarkers, attachToCheckId }) => {
    const r = await api<{
      verdict: string;
      reasons: string[];
      signals: Record<string, unknown>;
      attached: boolean;
    }>('/adjudicate', {
      method: 'POST',
      body: JSON.stringify({ baselineFlowId, attackFlowId, referenceFlowId, bMarkers, attachToCheckId }),
    });
    const icon =
      r.verdict === 'confirmed' ? '🚨' : r.verdict === 'likely' ? '⚠️' : r.verdict === 'secure' ? '✅' : '❓';
    const out: string[] = [];
    out.push(`${icon} **BOLA verdict: ${r.verdict.toUpperCase()}**`);
    for (const reason of r.reasons) out.push(`   - ${reason}`);
    if (r.verdict === 'confirmed') {
      out.push('');
      out.push('   Unauthorized access PROVEN. Record it (replay_flow with intent+expectStatus if not already) and recommend "Save as Security spec" — only `confirmed` crystallizes into a CI gate.');
    } else if (r.verdict === 'likely') {
      out.push('');
      out.push('   Suspected but unproven (could be public/shared data). Use the source reader (read_source) to check the handler for a missing owner check before promoting.');
    }
    if (attachToCheckId !== undefined) {
      out.push('');
      out.push(r.attached ? `   Attached to check #${attachToCheckId}.` : `   ⚠ Check #${attachToCheckId} not found — verdict not attached.`);
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
