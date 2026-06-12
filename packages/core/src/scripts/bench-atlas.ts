/**
 * A/B benchmark for atlas grounding (S2 of the atlas design doc).
 *
 * Runs N full agent sessions WITHOUT the atlas digest, then N WITH it
 * (`HOVER_ATLAS_GROUNDING=1`), against the same devRoot + prompt, and compares
 * session duration, cost, turns, and tool-call count. This is the experiment
 * that decides whether grounding ships on by default.
 *
 * Assumes (same as bench-ttfb):
 *  - A debug Chrome on :9222 (`pnpm smoke:chrome`).
 *  - A dev server for the target example (e.g. `pnpm dev:example:e-commerce`).
 *  - An atlas at `<devRoot>/.hover/atlas.json` — accumulate one by saving a
 *    few specs in the example first; without it the ON arm degenerates into
 *    the OFF arm and the bench warns.
 *
 *   HOVER_BENCH_DEVROOT=examples/e-commerce \
 *   HOVER_BENCH_PROMPT="open the checkout page and verify the shipping form is visible" \
 *   pnpm --filter @hover-dev/core exec tsx src/scripts/bench-atlas.ts <n-per-arm>
 *
 * `n-per-arm` defaults to 3 (6 sessions total — these are full paid agent
 * runs, not snapshot pings; budget accordingly).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { startService } from '../service.js';
import type { InvokeEvent } from '../agents/types.js';
import { atlasPath } from '../atlas/atlas.js';

const PROMPT =
  process.env.HOVER_BENCH_PROMPT ??
  'Open the checkout page and verify the shipping address form is visible.';
const N = Number(process.argv[2] ?? 3);
const DEV_ROOT = resolve(process.env.HOVER_BENCH_DEVROOT ?? process.cwd());

interface RunStats {
  ms: number;
  costUsd?: number;
  turns?: number;
  toolCalls: number;
}

async function singleRun(): Promise<RunStats> {
  const service = await startService({
    port: 0,
    agentId: 'claude',
    model: 'sonnet',
    cdpUrl: 'http://localhost:9222',
    devRoot: DEV_ROOT,
  });

  return new Promise<RunStats>((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${service.port}`);
    let t0 = 0;
    let toolCalls = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close(1000);
      service.close().finally(fn);
    };
    const timeout = setTimeout(
      () => finish(() => reject(new Error('timed out after 180s'))),
      180_000,
    );

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
      if (msg.type !== 'event') return;
      const ev = msg.payload as InvokeEvent;
      if (ev.kind === 'tool_use') toolCalls += 1;
      if (ev.kind === 'session_end') {
        const ms = performance.now() - t0;
        if (ev.isError) {
          finish(() => reject(new Error(`session error: ${ev.summary ?? 'unknown'}`)));
        } else {
          finish(() => resolvePromise({ ms, costUsd: ev.costUsd, turns: ev.turns, toolCalls }));
        }
      }
    });
    ws.on('error', err => finish(() => reject(err)));
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

async function arm(label: string, grounding: boolean): Promise<RunStats[]> {
  process.env.HOVER_ATLAS_GROUNDING = grounding ? '1' : '0';
  console.log(`\n=== arm: ${label} ===`);
  const stats: RunStats[] = [];
  for (let i = 1; i <= N; i++) {
    try {
      const s = await singleRun();
      stats.push(s);
      console.log(
        `  run ${i}: ${s.ms.toFixed(0)} ms, ${s.toolCalls} tool calls` +
          (s.costUsd != null ? `, $${s.costUsd.toFixed(4)}` : '') +
          (s.turns != null ? `, ${s.turns} turns` : ''),
      );
    } catch (err) {
      console.error(`  run ${i}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return stats;
}

function summarize(label: string, stats: RunStats[]): void {
  if (stats.length === 0) {
    console.log(`${label}: no successful runs`);
    return;
  }
  const costs = stats.map(s => s.costUsd).filter((c): c is number => c != null);
  console.log(
    `${label}: median ${median(stats.map(s => s.ms)).toFixed(0)} ms, ` +
      `median ${median(stats.map(s => s.toolCalls))} tool calls` +
      (costs.length ? `, median $${median(costs).toFixed(4)}` : ''),
  );
}

async function main() {
  console.log(`devRoot: ${DEV_ROOT}`);
  console.log(`prompt:  ${JSON.stringify(PROMPT)}`);
  console.log(`runs per arm: ${N}`);
  if (!existsSync(atlasPath(DEV_ROOT))) {
    console.warn(
      `\n⚠ no atlas at ${atlasPath(DEV_ROOT)} — the ON arm will be identical to OFF.\n` +
        `  Accumulate one first: run sessions in this example and save them as specs.`,
    );
  }
  const off = await arm('grounding OFF', false);
  const on = await arm('grounding ON', true);
  console.log('\n=== summary ===');
  summarize('OFF', off);
  summarize('ON ', on);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
