/**
 * Persist a session's API traffic + recorded checks under
 * `.hover/api/<sessionId>.json`, bound to the session-ledger id.
 *
 * The `hover:run:end` hook calls this so an api-test run's full API surface
 * (every flow the proxy saw + every api_request / replay_flow the agent issued,
 * plus the checks that carry an assertion) is durably recorded — not just held
 * in the resident proxy's memory. Findable later by session id; the source for
 * re-crystallization / the optimization pass.
 *
 * Best-effort: never throws to the caller (a record failure must not break a
 * run). It holds RAW auth headers / cookies / bodies, so it lives under
 * `.hover/cache/` — the disposable, always-git-ignored bucket — NOT under a
 * commit-worthy path: a user project's policy is "ignore cache/, commit the
 * rest", and these records must never be committed. The crystallized spec
 * redacts secrets to `process.env` refs separately.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Flow } from './mitm/flows.js';
import type { SecurityCheckStep } from '@hover-dev/probe-engine';

export async function writeApiRecord(
  devRoot: string,
  sessionId: string,
  data: { flows: Flow[]; checks: SecurityCheckStep[] },
): Promise<void> {
  if (!sessionId || (data.flows.length === 0 && data.checks.length === 0)) return;
  try {
    const dir = join(devRoot, '.hover', 'cache', 'api');
    await mkdir(dir, { recursive: true });
    const record = {
      version: 1,
      sessionId,
      recordedAt: new Date().toISOString(),
      flowCount: data.flows.length,
      checkCount: data.checks.length,
      // Checks carry the assertion (intent + expectStatus + observed) — these are
      // what crystallize into the .api-test.spec.ts.
      checks: data.checks,
      // Full traffic for inspection / re-crystallization.
      flows: data.flows.map((f) => ({
        id: f.id,
        mutated: f.mutated,
        request: {
          method: f.request.method,
          url: f.request.url,
          headers: f.request.headers,
          bodyText: f.request.bodyText,
        },
        response: f.response
          ? {
              status: f.response.statusCode,
              statusMessage: f.response.statusMessage,
              headers: f.response.headers,
              bodyText: f.response.bodyText,
            }
          : null,
      })),
    };
    await writeFile(join(dir, `${sessionId}.json`), JSON.stringify(record, null, 2) + '\n', 'utf-8');
  } catch {
    /* best-effort — never break a run on a record write */
  }
}
