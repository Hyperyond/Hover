import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectAgents } from './agents/detect.js';
import { invokeAgent } from './agents/invoke.js';
import type { InvokeEvent } from './agents/types.js';
import { connectAndListTabs } from './playwright/preflight.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_CONFIG = resolve(HERE, '..', 'mcp.config.json');

const CDP_URL = process.env.HOVER_CDP ?? 'http://localhost:9222';
const AGENT_ID = process.env.HOVER_AGENT ?? 'claude';
const MODEL = process.env.HOVER_MODEL ?? 'sonnet';
const TARGET = process.argv[2] ?? 'http://localhost:5173/';
const PROMPT = process.argv[3] ?? defaultPromptFor(TARGET);

const CHROME_CMD = `pnpm smoke:chrome    # or: pnpm exec hover-chrome`;

function defaultPromptFor(target: string): string {
  if (target.includes('localhost:5173')) {
    // Tailored to examples/basic-app (login + counter + todos)
    return [
      `The user's Chrome is connected via CDP and basic-app is running at ${target}.`,
      `Step 1: call browser_tabs(action="list"). If no tab is on ${target}, navigate there.`,
      `Step 2: in the Login section, fill the email field with "claude@sparkplay.io" and the password field with "demo1234", then click Submit.`,
      `Step 3: verify the welcome message now shows "claude@sparkplay.io".`,
      `Step 4: in the Counter section, click the "+1" button three times. Verify the displayed count reads 3.`,
      `Step 5: briefly summarize what you did and whether each step succeeded.`,
    ].join(' ');
  }
  return [
    `The user's Chrome is connected via CDP.`,
    `Step 1: call browser_tabs(action="list") to see open tabs.`,
    `Step 2: if no tab is on ${target}, navigate there with browser_navigate.`,
    `Step 3: do something visible on the page (click a link, fill a form).`,
    `Step 4: briefly describe what page you ended up on.`,
  ].join(' ');
}

function render(ev: InvokeEvent): void {
  switch (ev.kind) {
    case 'session_start':
      console.log(`• Session ${ev.sessionId}${ev.model ? ` (model: ${ev.model})` : ''}`);
      return;
    case 'mcp_status':
      console.log(`• MCP ${ev.server}: ${ev.status}`);
      return;
    case 'tool_use': {
      const args = JSON.stringify(ev.input ?? {});
      const short = args.length > 120 ? args.slice(0, 117) + '...' : args;
      console.log(`  → ${ev.tool} ${short}`);
      return;
    }
    case 'tool_result':
      console.log(`  ←${ev.isError ? ' [ERROR]' : ''}`);
      return;
    case 'text':
      console.log(`  AI: ${ev.text}`);
      return;
    case 'usage': {
      // Mid-run running totals — keep the CLI output light by re-printing on
      // a single carriage-return line. The widget displays the same data as
      // a live chip in the header.
      const cost = ev.costUsd != null ? `$${ev.costUsd.toFixed(4)}` : '—';
      const turns = ev.turns != null ? `${ev.turns}t` : '';
      process.stdout.write(`\r  • running · ${turns} · ${cost}        `);
      return;
    }
    case 'session_end': {
      const turns = ev.turns != null ? ` ${ev.turns} turn${ev.turns === 1 ? '' : 's'}` : '';
      const cost = ev.costUsd != null ? `, cost $${ev.costUsd.toFixed(4)}` : '';
      console.log(`\n• Done${turns}${cost}${ev.isError ? ' [ERROR]' : ''}`);
      if (ev.summary) console.log(`  ${ev.summary}`);
      return;
    }
    case 'raw':
      console.log(`  ? ${ev.line}`);
      return;
  }
}

async function main(): Promise<number> {
  // 1. Detect agents
  const detected = await detectAgents();
  console.log(`• Detected ${detected.length} agent${detected.length === 1 ? '' : 's'} on PATH:`);
  detected.forEach(d => console.log(`    └ ${d.descriptor.id} → ${d.binPath}`));
  if (!detected.some(d => d.descriptor.id === AGENT_ID)) {
    console.error(`\n✗ Requested agent "${AGENT_ID}" not found on PATH.`);
    return 1;
  }

  // 2. CDP preflight
  process.stdout.write(`\n• Connecting to user Chrome at ${CDP_URL} ... `);
  let tabs: string[];
  try {
    tabs = await connectAndListTabs(CDP_URL);
  } catch (e) {
    console.log('FAIL');
    console.error(`\n  ${(e as Error).message}\n`);
    console.error(`  Start Chrome with this command, then re-run:\n`);
    console.error(`    ${CHROME_CMD}\n`);
    return 1;
  }
  console.log(`OK (${tabs.length} tab${tabs.length === 1 ? '' : 's'})`);
  tabs.forEach(t => console.log(`    └ ${t}`));

  // 3. Invoke agent and stream events.
  // No default budget cap — running cost is reported via 'usage' events so
  // the CLI / widget can show a live counter; user hits Ctrl-C / Stop when
  // they've seen enough. Set HOVER_MAX_BUDGET_USD to re-enable a hard cap.
  const maxBudgetUsd = process.env.HOVER_MAX_BUDGET_USD
    ? Number(process.env.HOVER_MAX_BUDGET_USD)
    : undefined;
  const budgetTag = maxBudgetUsd != null ? `$${maxBudgetUsd} budget` : 'no budget cap';
  console.log(`\n• Invoking ${AGENT_ID} (model: ${MODEL}, strict MCP sandbox, ${budgetTag})\n`);
  for await (const ev of invokeAgent({
    agentId: AGENT_ID,
    prompt: PROMPT,
    mcpConfig: MCP_CONFIG,
    allowedTools: ['mcp__playwright'],
    disallowedTools: ['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob', 'Task', 'WebFetch', 'WebSearch'],
    maxBudgetUsd,
    model: MODEL,
  })) {
    render(ev);
  }
  return 0;
}

main().then(
  code => process.exit(code),
  err => {
    console.error('\nFatal:', err);
    process.exit(1);
  },
);
