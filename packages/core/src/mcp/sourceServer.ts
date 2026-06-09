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
