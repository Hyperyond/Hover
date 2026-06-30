import { chromium, type Browser, type Page } from 'playwright-core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  launchDebugChrome,
  writeSpec,
  writeApiSpec,
  writeFact,
  loadMemory,
  formatMemoryForPrompt,
  readSidecar,
  type SkillStep,
  type ApiCheck,
} from '@hover-dev/core/engine';
import { HoverMcpController } from './mcp/controller.js';
import { createHoverMcpServer } from './mcp/server.js';

/*
 * `hover-mcp` — the MCP-first surface. Add it to your OWN agent (Claude Code,
 * Cursor, …); the agent drives the app through Hover's grounded tools and calls
 * crystallize_spec to save a plain Playwright spec. Hover spawns no agent here —
 * the calling agent IS the intelligence; Hover guarantees record==replay at the
 * output. Config via env: HOVER_TARGET, HOVER_CDP_PORT, HOVER_PROJECT_ROOT.
 *
 * NOTE: stdio is the MCP transport — never write to stdout from this process.
 */

const TARGET = process.env.HOVER_TARGET || 'http://localhost:5173';
const PORT = Number(process.env.HOVER_CDP_PORT || 9222);
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
  crystallize: async (name: string, description: string | undefined, steps: SkillStep[]) => {
    const res = await writeSpec({ devRoot: DEV_ROOT, name, description, steps, startUrl: TARGET, overwrite: true });
    return { path: res.path };
  },
  crystallizeApi: async (name: string, description: string | undefined, checks: ApiCheck[]) => {
    const res = await writeApiSpec({ devRoot: DEV_ROOT, name, description, checks, startUrl: TARGET, overwrite: true });
    return { path: res.path };
  },
  recordFact: (title, rule, type) =>
    writeFact(DEV_ROOT, { name: title, description: title, type, body: rule }),
  recall: async () => formatMemoryForPrompt(await loadMemory(DEV_ROOT)),
  readSpecSteps: async (slug: string) => {
    const sc = await readSidecar(DEV_ROOT, slug);
    return sc ? { steps: sc.steps, startUrl: TARGET } : null;
  },
});

const server = createHoverMcpServer(controller);
await server.connect(new StdioServerTransport());
