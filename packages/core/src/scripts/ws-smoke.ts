/**
 * End-to-end WS smoke test: connect to the Hover service, send a command,
 * and stream events back to stdout. Exits 0 on session_end (success or
 * agent-reported error), 1 on connection/protocol failure.
 *
 *   pnpm --filter @hover/core ws-smoke
 *   pnpm --filter @hover/core ws-smoke "your custom prompt here"
 */
import { WebSocket } from 'ws';
import type { InvokeEvent } from '../agents/types.js';

const PORT = Number(process.env.HOVER_PORT ?? 51789);
const URL = `ws://127.0.0.1:${PORT}`;
const PROMPT =
  process.argv[2] ??
  'List the open tabs, then say which one is the basic-app dev server.';
// Pass HOVER_RESUME=<sessionId> to continue an earlier conversation —
// claude.ts will translate this into `--resume <id>` argv.
const RESUME = process.env.HOVER_RESUME;

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log(`• WS connected to ${URL}`);
  if (RESUME) console.log(`• Resuming session ${RESUME.slice(0, 8)}…`);
  console.log(`• Sending: ${PROMPT}\n`);
  ws.send(
    JSON.stringify({
      type: 'command',
      payload: { text: PROMPT, sessionId: RESUME },
    }),
  );
});

ws.on('error', err => {
  console.error(`✗ WS error: ${err.message}`);
  process.exit(1);
});

ws.on('close', code => {
  if (code !== 1000) {
    console.error(`✗ WS closed unexpectedly (code ${code})`);
    process.exit(1);
  }
});

ws.on('message', raw => {
  let msg: { type: string; payload?: unknown };
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    console.log('? unparseable:', raw.toString());
    return;
  }
  if (msg.type === 'hello') {
    console.log(`• hello: ${JSON.stringify(msg.payload)}`);
    return;
  }
  if (msg.type === 'error') {
    console.log(`✗ server error:`, msg.payload);
    return;
  }
  if (msg.type !== 'event') return;
  const ev = msg.payload as InvokeEvent;
  switch (ev.kind) {
    case 'session_start':
      console.log(`• session ${ev.sessionId} (${ev.model ?? '?'})`);
      break;
    case 'mcp_status':
      console.log(`• mcp/${ev.server}: ${ev.status}`);
      break;
    case 'tool_use': {
      const args = JSON.stringify(ev.input ?? {});
      const short = args.length > 100 ? args.slice(0, 97) + '...' : args;
      console.log(`  → ${ev.tool} ${short}`);
      break;
    }
    case 'tool_result':
      console.log(`  ←${ev.isError ? ' [ERROR]' : ''}`);
      break;
    case 'text':
      console.log(`  AI: ${ev.text}`);
      break;
    case 'session_end':
      console.log(
        `\n• Done · ${ev.turns ?? '?'} turns, $${(ev.costUsd ?? 0).toFixed(4)}${ev.isError ? ' [ERROR]' : ''}`,
      );
      ws.close(1000);
      setTimeout(() => process.exit(0), 100);
      break;
    case 'raw':
      break;
  }
});
