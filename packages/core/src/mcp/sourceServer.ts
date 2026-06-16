#!/usr/bin/env node
/**
 * Hover source-reader MCP server — the runtime behind the opt-in `codeContext`
 * switch. Spawned by the agent (Claude Code / Codex) as a stdio subprocess when
 * codeContext is enabled, in addition to Playwright MCP. It gives the agent
 * READ-ONLY, fenced access to the project's source so it can author smarter
 * tests and do white-box security/pentest work (read the actual query / authz
 * check, not just the rendered DOM).
 *
 * This is the ONE place Hover relaxes "the agent only touches the browser", so
 * the safety is all in the fence (src/mcp/sourceFence.ts) + the guards here:
 *   - every path is resolved INSIDE the project root (no `..` / absolute escape)
 *   - a realpath re-check defeats symlink escape
 *   - secret / VCS / dependency / build files are refused (.env, keys, .git, …)
 *   - read-only: there is no write / exec / delete tool here
 *   - a size cap + a binary guard keep it to actual source
 *
 * The project root comes in via env:
 *   HOVER_PROJECT_ROOT   absolute path to the dev project root (devRoot)
 *
 * Tools exposed:
 *   read_source({ path })            → the file's text (fenced, ≤256 KB, text-only)
 *   list_source({ subdir? })         → a shallow dir listing (secrets filtered out)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { WebSocket } from 'ws';
import { resolveSourcePath, isWithinRoot } from './sourceFence.js';

const root = process.env.HOVER_PROJECT_ROOT;
if (!root) {
  process.stderr.write('[hover-source-mcp] HOVER_PROJECT_ROOT must be set by the host.\n');
  process.exit(1);
}
const ROOT: string = root;

const MAX_BYTES = 256 * 1024;

function md(text: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text }] };
}

// ── Read-approval gate ──────────────────────────────────────────────────────
// When the host runs us with HOVER_SOURCE_GATE=ask, every read/list first asks
// the editor (over the Hover service WS at HOVER_APPROVAL_PORT) for the user's
// one-click approval. The reader is fenced + read-only, so the gate is consent
// UX, not a security boundary: if the editor can't be reached or doesn't answer
// within 30s we FAIL OPEN (allow) rather than stall the agent's run.
const GATE = process.env.HOVER_SOURCE_GATE;
const APPROVAL_PORT = process.env.HOVER_APPROVAL_PORT;
let approvalWs: WebSocket | null = null;
let approvalSeq = 0;
const pendingApprovals = new Map<string, (allow: boolean) => void>();

function ensureApprovalWs(): WebSocket | null {
  if (GATE !== 'ask' || !APPROVAL_PORT) return null;
  if (approvalWs && (approvalWs.readyState === WebSocket.OPEN || approvalWs.readyState === WebSocket.CONNECTING)) return approvalWs;
  try {
    const sock = new WebSocket(`ws://127.0.0.1:${APPROVAL_PORT}`);
    sock.on('message', (data: Buffer) => {
      try {
        const m = JSON.parse(data.toString()) as { type?: string; payload?: { approvalId?: string; allow?: boolean } };
        if (m?.type === 'source-approval-response' && m.payload?.approvalId) {
          const settle = pendingApprovals.get(m.payload.approvalId);
          if (settle) settle(m.payload.allow === true);
        }
      } catch { /* ignore malformed */ }
    });
    // Channel lost → fail OPEN for every waiting read (the reader is fenced +
    // read-only; the gate is consent UX, not a security boundary, so never hang
    // a run on a dead channel). The user taking their time is NOT a loss — only
    // a closed/errored socket settles here.
    const drain = (): void => { for (const s of [...pendingApprovals.values()]) s(true); };
    sock.on('error', () => { drain(); });
    sock.on('close', () => { if (approvalWs === sock) approvalWs = null; drain(); });
    approvalWs = sock;
  } catch {
    approvalWs = null;
  }
  return approvalWs;
}

async function approve(path: string, kind: 'read' | 'list'): Promise<boolean> {
  if (GATE !== 'ask' || !APPROVAL_PORT) return true; // not gated → allow
  const sock = ensureApprovalWs();
  if (!sock) return true; // no channel → fail open
  const id = `a${++approvalSeq}`;
  return new Promise<boolean>((resolve) => {
    // NO timeout: the consent prompt waits for the user (they may not see it for
    // a while — that must never auto-allow). It settles only on their answer, or
    // when the channel drops (drain() above → fail open), or run cancel.
    const settle = (allow: boolean): void => {
      if (!pendingApprovals.has(id)) return;
      pendingApprovals.delete(id);
      resolve(allow);
    };
    pendingApprovals.set(id, settle);
    const req = (): void => sock.send(JSON.stringify({ type: 'source-approval-request', payload: { approvalId: id, sourcePath: path, sourceKind: kind } }));
    if (sock.readyState === WebSocket.OPEN) req();
    else sock.once('open', req);
  });
}

const server = new McpServer({ name: 'hover-source', version: '0.0.0' });

server.registerTool(
  'read_source',
  {
    description:
      "Read a source file from THIS project (read-only). Pass a repo-relative path (e.g. the one in an element's data-hover-source, `src/app/login.tsx:42` → path `src/app/login.tsx`). Fenced to the project root: paths that escape it, or that name secrets / keys / .env / .git / node_modules / build output, are refused. Use this to write tests against the real selectors & routes, or — in security/pentest mode — to confirm a finding against the actual server code (the SQL query, the authz check). You cannot write, run, or delete anything.",
    inputSchema: {
      path: z.string().describe('Repo-relative path to a source file, e.g. "src/api/orders.ts".'),
    },
  },
  async ({ path }) => {
    if (!(await approve(path, 'read'))) return md(`✗ source read declined by the user — continue from what's visible on the page.`);
    const f = resolveSourcePath(ROOT, path);
    if (!f.ok) return md(`✗ ${f.reason}`);
    let real: string;
    try {
      real = realpathSync(f.abs);
    } catch {
      return md(`✗ not found: ${f.rel}`);
    }
    if (!isWithinRoot(ROOT, real)) return md(`✗ refused: "${f.rel}" resolves (via a symlink) outside the project root`);
    let st;
    try {
      st = statSync(real);
    } catch {
      return md(`✗ not found: ${f.rel}`);
    }
    if (st.isDirectory()) return md(`✗ "${f.rel}" is a directory — use list_source`);
    if (st.size > MAX_BYTES) return md(`✗ "${f.rel}" is ${Math.round(st.size / 1024)} KB — too large to read (cap ${MAX_BYTES / 1024} KB)`);
    let buf: Buffer;
    try {
      buf = readFileSync(real);
    } catch (e) {
      return md(`✗ could not read ${f.rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Binary guard — a NUL byte in the first 8 KB means it isn't source text.
    if (buf.subarray(0, 8192).includes(0)) return md(`✗ "${f.rel}" looks binary — refused`);
    return md(`\`\`\`\n// ${f.rel}\n${buf.toString('utf-8')}\n\`\`\``);
  },
);

server.registerTool(
  'list_source',
  {
    description:
      'List the entries of a directory in THIS project (shallow, read-only). Omit `subdir` for the project root. Secret / VCS / dependency / build entries are filtered out. Use it to discover what source exists before reading a file.',
    inputSchema: {
      subdir: z.string().optional().describe('Repo-relative directory, e.g. "src/api". Omit for the root.'),
    },
  },
  async ({ subdir }) => {
    if (!(await approve(subdir || '.', 'list'))) return md(`✗ source listing declined by the user.`);
    let dirAbs = ROOT;
    let base = '';
    if (subdir && subdir.trim() && subdir.trim() !== '.') {
      const d = resolveSourcePath(ROOT, subdir);
      if (!d.ok) return md(`✗ ${d.reason}`);
      dirAbs = d.abs;
      base = d.rel;
    }
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return md(`✗ not a readable directory: ${base || '.'}`);
    }
    const rows: string[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = base ? `${base}/${e.name}` : e.name;
      // Filter via the same fence so secrets/build/VCS never even show up.
      if (!resolveSourcePath(ROOT, rel).ok) continue;
      rows.push(e.isDirectory() ? `${rel}/` : rel);
    }
    if (rows.length === 0) return md(`(empty or fully filtered) ${base || '.'}`);
    return md(`${base || '.'} —\n${rows.join('\n')}`);
  },
);

await server.connect(new StdioServerTransport());
