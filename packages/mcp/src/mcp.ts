import { basename } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  launchDebugChrome,
  writeSpec,
  writeApiSpec,
  writeFact,
  recallMemory,
  readFact,
  formatFact,
  readSidecar,
  detectExtractableFlows,
  extractPageObjects,
  buildOptimizeBrief,
  saveOptimizedCandidate,
  promoteOptimizedCandidate,
  lintWiki,
  appendWikiLog,
  type SkillStep,
  type ApiCheck,
  type Redaction,
} from '@hover-dev/core/engine';
import { fetchHealRequests, readCloudCredentials } from '@hover-dev/core/cloud';
import { HoverMcpController } from './mcp/controller.js';
import { createHoverMcpServer } from './mcp/server.js';

/*
 * `hover-mcp` — the MCP-first surface. Add it to your OWN agent (Claude Code,
 * Cursor, …); the agent drives the app through Hover's grounded tools and calls
 * crystallize_spec to save a plain Playwright spec. Hover spawns no agent here —
 * the calling agent IS the intelligence; Hover guarantees record==replay at the
 * output. Config via env: HOVER_TARGET, HOVER_CDP_PORT, HOVER_PROJECT_ROOT,
 * HOVER_LANG (language the workflow prompts tell the agent to converse in).
 *
 * NOTE: stdio is the MCP transport — never write to stdout from this process.
 */

const TARGET = process.env.HOVER_TARGET || 'http://localhost:5173';
const PORT = Number(process.env.HOVER_CDP_PORT || 9222);
const LANG = process.env.HOVER_LANG;
const DEV_ROOT = process.env.HOVER_PROJECT_ROOT || process.cwd();
const CDP_URL = `http://localhost:${PORT}`;

const originOf = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

let browser: Browser | null = null;

/** Launch/connect the debug Chrome lazily and return the page on the app. */
async function getPage(): Promise<Page> {
  if (!browser || !browser.isConnected()) {
    await launchDebugChrome({ port: PORT, url: TARGET });
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 8000 });
  }
  const pages = browser.contexts().flatMap((ctx) => ctx.pages());
  const want = originOf(TARGET);
  const match = want ? pages.find((p) => originOf(p.url()) === want) : undefined;
  if (match) return match;
  if (pages.length) return pages[pages.length - 1];
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  return ctx.newPage();
}

const controller = new HoverMcpController({
  getPage,
  crystallize: async (name: string, description: string | undefined, steps: SkillStep[], redactions: Redaction[]) => {
    const res = await writeSpec({ devRoot: DEV_ROOT, name, description, steps, redactions, startUrl: TARGET, overwrite: true });
    await appendWikiLog(DEV_ROOT, 'crystallize', `${basename(res.path)} — ${name}`);
    return { path: res.path };
  },
  crystallizeApi: async (name: string, description: string | undefined, checks: ApiCheck[]) => {
    const res = await writeApiSpec({ devRoot: DEV_ROOT, name, description, checks, startUrl: TARGET, overwrite: true });
    await appendWikiLog(DEV_ROOT, 'api', `${basename(res.path)} — ${name}`);
    return { path: res.path };
  },
  recordFact: (title, rule, type) =>
    writeFact(DEV_ROOT, { name: title, description: title, type, body: rule }),
  recall: () => recallMemory(DEV_ROOT),
  recallFact: async (name: string) => {
    const fact = await readFact(DEV_ROOT, name);
    return fact ? formatFact(fact) : null;
  },
  readSpecSteps: async (slug: string) => {
    const sc = await readSidecar(DEV_ROOT, slug);
    return sc ? { steps: sc.steps, startUrl: TARGET } : null;
  },
  detectSharedFlows: () => detectExtractableFlows(DEV_ROOT),
  extractPageObjects: async () => {
    const res = await extractPageObjects(DEV_ROOT);
    if (res.pages.length) {
      await appendWikiLog(DEV_ROOT, 'extract', `${res.pages.length} page object(s), folded ${res.folded.length} spec(s)`);
    }
    return res;
  },
  optimizeBrief: async (slug: string) => {
    try {
      const { prompt } = await buildOptimizeBrief(DEV_ROOT, slug);
      return { prompt };
    } catch (e) {
      return { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
    }
  },
  saveOptimized: (slug: string, code: string) => saveOptimizedCandidate(DEV_ROOT, slug, code),
  promoteOptimized: (slug: string) => promoteOptimizedCandidate(DEV_ROOT, slug),
  lintWiki: () => lintWiki(DEV_ROOT),
  cloudFailures: async (repo?: string) => {
    const creds = readCloudCredentials();
    if (!creds) {
      return {
        error:
          'Hover Cloud not connected — set HOVER_CLOUD_TOKEN (mint one at https://cloud.gethover.dev → Settings → Access tokens) or run "Hover: Connect Hover Cloud" in VS Code.',
      };
    }
    try {
      return await fetchHealRequests(creds, { status: 'open', ...(repo ? { repo } : {}) });
    } catch (e) {
      return { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
    }
  },
});

const server = createHoverMcpServer(controller, { lang: LANG });
await server.connect(new StdioServerTransport());
