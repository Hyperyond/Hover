/**
 * Benchmark "time to first tool_use" for the LLM-driven loop.
 *
 * Assumes:
 *  - A debug Chrome is running on :9222 (start with `pnpm smoke:chrome`).
 *  - A dev server is running so the agent has something to drive
 *    (`pnpm dev:example:basic-app`).
 *
 * Per iteration:
 *  - Start a fresh Hover service (cold — kills any prior service to avoid
 *    cached MCP process state across iterations).
 *  - WS-connect, send a fixed command, mark t0 right before send().
 *  - Mark t1 on the first tool_use event from the agent.
 *  - Report (t1 - t0) in milliseconds. Close service + WS.
 *
 *   pnpm --filter @hover-dev/core exec tsx src/scripts/bench-ttfb.ts <n>
 *
 * `n` defaults to 5. Prints individual timings + median + min/max.
 */
import { WebSocket } from 'ws';
import { startService } from '../service.js';
import type { InvokeEvent } from '../agents/types.js';

const PROMPT = process.env.HOVER_BENCH_PROMPT ?? 'Take a snapshot of the page.';
const ITERATIONS = Number(process.argv[2] ?? 5);

async function singleRun(): Promise<number> {
  const service = await startService({
    // Use 0 to let the kernel pick — avoids cross-iter EADDRINUSE races.
    port: 0,
    agentId: 'claude',
    model: 'sonnet',
    cdpUrl: 'http://localhost:9222',
    devRoot: process.cwd(),
  });

  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${service.port}`);
    let t0 = 0;
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        ws.close(1000);
        service.close();
        reject(new Error('timed out waiting for first tool_use after 60s'));
      }
    }, 60_000);

    ws.on('open', () => {
      t0 = performance.now();
      ws.send(JSON.stringify({ type: 'command', payload: { text: PROMPT } }));
    });

    ws.on('message', raw => {
      let msg: { type: string; payload?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (process.env.HOVER_BENCH_VERBOSE === '1') {
        process.stderr.write(`    [event] ${raw.toString().slice(0, 200)}\n`);
      }
      if (msg.type !== 'event') return;
      const ev = msg.payload as InvokeEvent;
      if (ev.kind === 'tool_use' && !resolved) {
        const t1 = performance.now();
        const ms = t1 - t0;
        resolved = true;
        clearTimeout(timeout);
        ws.close(1000);
        service.close().finally(() => resolve(ms));
      }
      if (ev.kind === 'session_end' && !resolved) {
        // Ran without any tool_use — agent went text-only or errored.
        // Reject so the bench surfaces the issue instead of recording
        // a misleadingly tiny "first tool_use" timing.
        resolved = true;
        clearTimeout(timeout);
        const evAny = ev as unknown as { isError?: boolean };
        const reason = evAny.isError ? 'session_end (error)' : 'session_end without tool_use';
        ws.close(1000);
        service.close().finally(() => reject(new Error(reason)));
      }
    });

    ws.on('error', err => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      service.close().finally(() => reject(err));
    });
  });
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function main() {
  console.log(`prompt: ${JSON.stringify(PROMPT)}`);
  console.log(`iterations: ${ITERATIONS}`);
  console.log('');
  const results: number[] = [];
  for (let i = 1; i <= ITERATIONS; i++) {
    try {
      const ms = await singleRun();
      results.push(ms);
      console.log(`  run ${i}: ${ms.toFixed(0).padStart(5)} ms`);
    } catch (err) {
      console.error(`  run ${i}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
    // Small gap between runs so any process-cleanup tail can flush.
    await new Promise(r => setTimeout(r, 500));
  }
  if (results.length === 0) {
    console.error('\nNo successful runs.');
    process.exit(1);
  }
  console.log('');
  console.log(`min:    ${Math.min(...results).toFixed(0)} ms`);
  console.log(`median: ${median(results).toFixed(0)} ms`);
  console.log(`max:    ${Math.max(...results).toFixed(0)} ms`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
