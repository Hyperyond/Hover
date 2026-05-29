/**
 * Benchmark agent success rate on the multi-tab "Pay with PayHover" flow.
 *
 * Why this exists — v0.10's central theme is "agent can drive cross-tab
 * flows in the wild." The system-prompt addendum (cdpHint.ts rule 5/6/7)
 * is the lever we're tuning. This script gives us a number to tune
 * against: across N iterations, how often does the agent get from
 * "browse the store" to "Order placed"?
 *
 * Per iteration the agent has to:
 *   1. Browse the e-commerce store, add 1+ items to cart, go to checkout.
 *   2. Fill the shipping form.
 *   3. Pick "Pay with PayHover" (opens a new tab at localhost:5177).
 *   4. Switch to the new tab, fill card number + CVV, click Continue.
 *   5. Wait ~600ms for the simulated 3DS pre-check.
 *   6. Fill the 6-digit OTP (always 123456 in the sandbox).
 *   7. Click Confirm. The provider tab closes itself.
 *   8. Switch back to the original tab, observe the "Order placed" view.
 *
 * Steps 3, 4, 7, 8 are the failure-prone ones.
 *
 * Assumes:
 *   - Debug Chrome on :9222 (run `pnpm smoke:chrome`).
 *   - e-commerce on :5174 AND payment-provider on :5177 both running
 *     (run `pnpm dev:example:e-commerce` and `pnpm dev:example:payment-provider`
 *     in two terminals before invoking this).
 *
 * Usage:
 *   pnpm --filter @hover-dev/core exec tsx src/scripts/bench-multi-tab.ts [n]
 *   pnpm bench-multi-tab [n]
 *
 * `n` defaults to 5. Per-iteration timeout is 5 minutes — multi-tab flows
 * are slow because the agent does a lot of browser_snapshot calls.
 *
 * Output: per-run pass/fail + final summary (success rate, median wall
 * time, median turns, median cost in $). A/B prompt changes by running
 * once on each branch and comparing.
 */
import { WebSocket } from 'ws';
import { startService } from '../service.js';
import type { InvokeEvent } from '../agents/types.js';

const PROMPT =
  process.env.HOVER_BENCH_PROMPT ??
  [
    'Open http://localhost:5174 (Hover Store).',
    'Add any item to the cart, go to checkout, fill the shipping form with',
    'realistic values, then choose "Pay with PayHover". A new tab opens at',
    'the payment provider — switch to it, fill in card 4242 4242 4242 4242',
    'with CVV 123, click Continue, wait for the OTP step, enter 123456,',
    'click Confirm. The popup will close. Switch back to the original tab',
    'and verify the order shows as placed.',
  ].join(' ');

const ITERATIONS = Number(process.argv[2] ?? 5);
const PER_RUN_TIMEOUT_MS = 5 * 60 * 1000;

interface RunResult {
  /** Whether the agent reported success (session_end.isError === false). */
  ok: boolean;
  /** Wall time from first WS open to session_end. */
  wallMs: number;
  /** Turns the agent took (counted by tool_use events). */
  turns: number;
  /** Cost in USD from the session_end event, if the agent reports it. */
  costUsd: number | null;
  /** Error / reason if !ok. */
  reason?: string;
}

async function singleRun(idx: number): Promise<RunResult> {
  process.stderr.write(`\n[bench-multi-tab] run ${idx + 1}/${ITERATIONS}\n`);

  const service = await startService({
    port: 0,
    agentId: 'claude',
    model: 'sonnet',
    cdpUrl: 'http://localhost:9222',
    devRoot: process.cwd(),
  });

  return new Promise<RunResult>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${service.port}`);
    const t0 = performance.now();
    let turns = 0;
    let costUsd: number | null = null;
    let resolved = false;

    const finish = (result: RunResult) => {
      if (resolved) return;
      resolved = true;
      try { ws.close(1000); } catch { /* already closed */ }
      service.close().finally(() => resolve(result));
    };

    const timeout = setTimeout(() => {
      finish({
        ok: false,
        wallMs: performance.now() - t0,
        turns,
        costUsd,
        reason: `timed out after ${PER_RUN_TIMEOUT_MS / 1000}s`,
      });
    }, PER_RUN_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'command', payload: { text: PROMPT } }));
    });

    ws.on('message', (raw) => {
      let msg: { type: string; payload?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'event') return;
      const ev = msg.payload as InvokeEvent;
      if (ev.kind === 'tool_use') {
        turns += 1;
        if (process.env.HOVER_BENCH_VERBOSE === '1') {
          const ev2 = ev as unknown as { name?: string };
          process.stderr.write(`    [turn ${turns}] ${ev2.name ?? '<tool>'}\n`);
        }
      }
      if (ev.kind === 'session_end') {
        clearTimeout(timeout);
        const evAny = ev as unknown as { isError?: boolean; costUsd?: number };
        if (typeof evAny.costUsd === 'number') costUsd = evAny.costUsd;
        finish({
          ok: !evAny.isError,
          wallMs: performance.now() - t0,
          turns,
          costUsd,
          reason: evAny.isError ? 'agent reported error' : undefined,
        });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      finish({
        ok: false,
        wallMs: performance.now() - t0,
        turns,
        costUsd,
        reason: `WS error: ${err.message}`,
      });
    });
  });
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUsd(usd: number | null): string {
  return usd == null ? '–' : `$${usd.toFixed(4)}`;
}

async function main(): Promise<void> {
  process.stderr.write(
    `[bench-multi-tab] ${ITERATIONS} iterations, per-run timeout ${PER_RUN_TIMEOUT_MS / 1000}s\n`,
  );
  process.stderr.write(
    `[bench-multi-tab] prompt: ${PROMPT.slice(0, 80)}…\n`,
  );

  const results: RunResult[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      const r = await singleRun(i);
      results.push(r);
      const status = r.ok ? '✓ PASS' : '✗ FAIL';
      process.stderr.write(
        `[bench-multi-tab] run ${i + 1}: ${status} · ${fmtMs(r.wallMs)} · ${r.turns} turns · ${fmtUsd(r.costUsd)}${r.reason ? ` · ${r.reason}` : ''}\n`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ok: false, wallMs: 0, turns: 0, costUsd: null, reason: msg });
      process.stderr.write(`[bench-multi-tab] run ${i + 1}: ✗ FAIL · setup error · ${msg}\n`);
    }
  }

  const passes = results.filter((r) => r.ok);
  const successRate = passes.length / results.length;

  process.stderr.write('\n[bench-multi-tab] summary\n');
  process.stderr.write(`  success rate: ${(successRate * 100).toFixed(0)}% (${passes.length}/${results.length})\n`);
  if (passes.length > 0) {
    process.stderr.write(`  median wall:  ${fmtMs(median(passes.map((r) => r.wallMs)))}\n`);
    process.stderr.write(`  median turns: ${median(passes.map((r) => r.turns)).toFixed(0)}\n`);
    const costs = passes.map((r) => r.costUsd).filter((c): c is number => c != null);
    if (costs.length > 0) {
      process.stderr.write(`  median cost:  ${fmtUsd(median(costs))}\n`);
    }
  }
  if (passes.length < results.length) {
    process.stderr.write(`\n  failures:\n`);
    results.forEach((r, i) => {
      if (!r.ok) process.stderr.write(`    run ${i + 1}: ${r.reason ?? 'unknown'}\n`);
    });
  }

  // Exit non-zero if EVERY run failed — useful for CI plumbing later. A
  // partial-pass run still exits 0 so we collect signal across branches.
  process.exit(passes.length === 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`[bench-multi-tab] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
