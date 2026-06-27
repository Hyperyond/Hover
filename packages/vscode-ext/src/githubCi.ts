/**
 * Cloudless CI integration (ci-integration Stage 2).
 *
 * Pulls a GitHub Actions run's Playwright JSON into the local `.hover/runs/`
 * ledger, so the Dashboard (pass/fail/flaky) and 🏥 self-heal consume CI results
 * for free — no Hover Cloud. The extension talks to GitHub directly via VS Code's
 * built-in GitHub auth; the generated workflow uploads the `hover-results`
 * artifact (see ciWorkflow.ts) which is what we fetch here.
 */
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';

const exec = promisify(execFile);
const WORKFLOW_NAME = 'Hover E2E';
const ARTIFACT_NAME = 'hover-results';
const RESULTS_FILE = 'hover-results.json';

export interface CiSyncResult {
  runId: number;
  /** success | failure | cancelled | … (the run's conclusion). */
  conclusion: string | null;
  htmlUrl: string;
  /** Workspace-relative ledger file we wrote the JSON to. */
  ledgerName: string;
}

/** Owner/repo from a git remote URL (ssh `git@github.com:o/r.git` or https). */
export function parseRepoFromRemote(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function originRepo(cwd: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await exec('git', ['config', '--get', 'remote.origin.url'], { cwd });
    return parseRepoFromRemote(stdout);
  } catch {
    return null;
  }
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!r.ok) throw new Error(`GitHub ${path.split('?')[0]} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

/**
 * Fetch the latest COMPLETED `Hover E2E` run, download its `hover-results`
 * artifact, and write the Playwright JSON into `.hover/runs/ci-<runId>.json`.
 * Returns null when there's no such run/artifact yet (CI not set up / not run).
 * Throws on no-remote or a GitHub/API error (the caller surfaces it).
 */
export async function syncCiResults(folder: vscode.Uri): Promise<CiSyncResult | null> {
  const repo = await originRepo(folder.fsPath);
  if (!repo) throw new Error('no GitHub `origin` remote found for this workspace');
  const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
  const token = session.accessToken;
  const { owner, repo: name } = repo;

  // Latest completed Hover E2E run.
  const runs = await ghJson<{ workflow_runs: { id: number; name: string; status: string; conclusion: string | null; html_url: string }[] }>(
    token, `/repos/${owner}/${name}/actions/runs?per_page=30`);
  const run = runs.workflow_runs.find((r) => r.name === WORKFLOW_NAME && r.status === 'completed');
  if (!run) return null;

  // Its hover-results artifact.
  const arts = await ghJson<{ artifacts: { id: number; name: string; expired: boolean }[] }>(
    token, `/repos/${owner}/${name}/actions/runs/${run.id}/artifacts`);
  const art = arts.artifacts.find((a) => a.name === ARTIFACT_NAME && !a.expired);
  if (!art) return null;

  // Download the artifact zip (fetch follows GitHub's redirect to the signed
  // URL), unzip, read the JSON entry.
  const zipRes = await fetch(`https://api.github.com/repos/${owner}/${name}/actions/artifacts/${art.id}/zip`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!zipRes.ok) throw new Error(`artifact download → ${zipRes.status} ${zipRes.statusText}`);
  const files = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  const entry = files[RESULTS_FILE] ?? Object.entries(files).find(([n]) => n.endsWith('.json'))?.[1];
  if (!entry) throw new Error(`${RESULTS_FILE} not found in the artifact`);

  // Write into the local run ledger — the Dashboard + self-heal already read
  // `.hover/runs/*.json`, so a CI result becomes a heal target with no new code.
  const ledgerName = `ci-${run.id}.json`;
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, '.hover', 'runs'));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.hover', 'runs', ledgerName), entry);

  return { runId: run.id, conclusion: run.conclusion, htmlUrl: run.html_url, ledgerName };
}
