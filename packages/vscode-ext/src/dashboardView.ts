/**
 * Dashboard DATA layer for the single Hover panel (see homeView.ts). No view of
 * its own anymore — the panel is one webview with tabs, and this module just
 * produces the `DashboardData` the Overview tab renders.
 *
 * Two independent sources, so the panel can toggle Local ↔ Remote:
 *   - LOCAL  — `.hover/runs/*.json` (Playwright reports) + the `__vibe_tests__/`
 *     catalogue + `.hover/conversations/**` token spend.
 *   - REMOTE — Hover Cloud's `GET /api/v1/dashboard` for this repo (CI runs it
 *     ingested), the same `DashboardData` shape.
 *
 * The shape + all pure computation live in `@hover-dev/core/dashboard`.
 */
import * as vscode from 'vscode';
import { fetchDashboard, readCloudCredentials } from '@hover-dev/core/cloud';
import {
  MAX_RUNS,
  buildDashboard,
  parsePlaywrightRun,
  type DashboardData,
  type RunSlice,
  type SpecFileRef,
} from '@hover-dev/core/dashboard';
/** Cloud connection state pushed to the webview (drives the sign-in gate). */
export type CloudState = { connected: true; url: string } | { connected: false };

/** Poll cadence for cloud-side changes (CI runs land without touching files). */
export const CLOUD_TTL_MS = 60_000;
const CLOUD_TIMEOUT_MS = 8_000;

export function cloudState(): CloudState {
  const creds = readCloudCredentials();
  return creds ? { connected: true, url: creds.url } : { connected: false };
}

async function readJson(uri: vscode.Uri): Promise<unknown | null> {
  try {
    return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8'));
  } catch {
    return null;
  }
}

async function localRunSlices(): Promise<RunSlice[]> {
  const runUris = (await vscode.workspace.findFiles('**/.hover/runs/*.json', '**/node_modules/**'))
    .sort((a, b) => a.path.localeCompare(b.path)) // filename is the ISO stamp → chronological
    .slice(-MAX_RUNS);
  const runs: RunSlice[] = [];
  for (const uri of runUris) {
    const json = await readJson(uri);
    if (!json) continue;
    const id = (uri.path.split('/').pop() ?? '').replace(/\.json$/, '');
    runs.push({ id, ts: id, specs: parsePlaywrightRun(json) });
  }
  return runs;
}

/** Agent runs (one meta.json per run, grouped by conversation) → 7-day token spend. */
async function localTokens7d(): Promise<number> {
  const sessUris = (await vscode.workspace.findFiles('**/.hover/conversations/*/*/meta.json', '**/node_modules/**'))
    .sort((a, b) => b.path.localeCompare(a.path))
    .slice(0, 40);
  const weekAgo = Date.now() - 7 * 864e5;
  let tokens7d = 0;
  for (const uri of sessUris) {
    const s = (await readJson(uri)) as { tokensUsed?: number; startedAt?: string } | null;
    if (!s) continue;
    const started = s.startedAt ? Date.parse(s.startedAt) : NaN;
    if (typeof s.tokensUsed === 'number' && (Number.isNaN(started) || started >= weekAgo)) tokens7d += s.tokensUsed;
  }
  return tokens7d;
}

/** The purely-local dashboard: `.hover/runs` + the on-disk spec catalogue. */
export async function gatherLocalDashboard(): Promise<DashboardData> {
  const specUris = await vscode.workspace.findFiles('**/__vibe_tests__/**/*.spec.ts', '**/node_modules/**');
  // basename → its file (for actions / open). Multiple specs can't share a
  // basename across folders in practice; last one wins.
  const files = new Map<string, SpecFileRef>();
  for (const u of specUris) files.set(u.path.split('/').pop() ?? '', { path: u.fsPath });
  const catalogueCount = files.size;
  const runs = await localRunSlices();
  return buildDashboard(runs, files, await localTokens7d(), catalogueCount);
}

// Cache the cloud fetch so file-watcher refresh bursts don't hammer the API.
// Keyed by repo so switching the linked project can't serve a stale dashboard.
let remoteCache: { at: number; repo: string; data: DashboardData | null } | undefined;

/** A specific repo's Cloud dashboard (CI runs Cloud ingested), or null when no
 *  repo is given / not connected / offline / no project for that repo. The repo
 *  MUST be resolved by the caller — never fall back to "all", or one repo's
 *  panel would show another project's data. Local paths get filled in so Remote
 *  rows can still open + run the on-disk spec. */
export async function gatherRemoteDashboard(repo: string | undefined, force = false): Promise<DashboardData | null> {
  if (!repo) return null;
  if (!force && remoteCache && remoteCache.repo === repo && Date.now() - remoteCache.at < CLOUD_TTL_MS) {
    return remoteCache.data;
  }
  const data = await (async (): Promise<DashboardData | null> => {
    const creds = readCloudCredentials();
    if (!creds) return null;
    try {
      const remote = await fetchDashboard(creds, repo, (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) }),
      );
      // Resolve each remote spec basename to a local file, so its row can still
      // open + run the spec that lives in this checkout.
      for (const row of remote.rows) {
        const hit = await vscode.workspace.findFiles(`**/__vibe_tests__/**/${row.name}`, '**/node_modules/**', 1);
        if (hit[0]) row.path = hit[0].fsPath;
      }
      return remote;
    } catch {
      return null;
    }
  })();
  remoteCache = { at: Date.now(), repo, data };
  return data;
}

/** Drop the cloud cache so the next gather re-fetches (explicit refresh / connect). */
export function invalidateRemoteCache(): void {
  remoteCache = undefined;
}
