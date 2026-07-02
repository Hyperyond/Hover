/**
 * Hover Cloud client — the PULL side of the cloud ↔ editor loop.
 *
 * Cloud (cloud.gethover.dev) ingests CI runs and queues a heal request per
 * drifted spec. Nothing in the cloud can reach into an editor: this module is
 * how the local surfaces (the VS Code extension, the MCP server) pull that
 * queue and feed it to the existing local heal flow. The fix stays local +
 * human-reviewed; a request auto-closes only when CI sees the spec pass again.
 *
 * Credentials resolve in a fixed chain so one sign-in covers every surface:
 *   1. HOVER_CLOUD_TOKEN (+ optional HOVER_CLOUD_URL) env vars — explicit, CI
 *   2. ~/.hover/credentials.json — written by "Hover: Connect Hover Cloud" in
 *      VS Code (or by hand); 0600, shared by the extension AND the MCP server
 *      (VS Code SecretStorage is extension-private, so it can't be the store).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RunFailure } from './specs/runFailures.js';
import type { DashboardData } from './dashboard.js';

export const DEFAULT_CLOUD_URL = 'https://cloud.gethover.dev';

export interface CloudCredentials {
  /** Personal access token minted at cloud Settings → Access tokens. */
  token: string;
  /** Cloud base URL; DEFAULT_CLOUD_URL unless self-configured. */
  url: string;
}

/** One drifted spec queued by the cloud, as /api/v1/heal-requests returns it.
 *  `hint` is RunFailure-shaped — feed it straight to the local heal flow. */
export interface CloudHealRequest {
  id: string;
  status: 'open' | 'routed' | 'healed' | 'dismissed';
  specFile: string;
  hint: RunFailure;
  createdAt: string;
  project: { id: string; name: string; repo: string };
  run: {
    id: string;
    branch: string | null;
    commitSha: string | null;
    ciUrl: string | null;
    /** Environment the spec drifted on — heal against THIS env's URL (matched
     *  to `.hover/environments.json`), not localhost. Null on older runs. */
    environment?: string | null;
    createdAt: string;
  };
}

export function credentialsPath(home: string = homedir()): string {
  return join(home, '.hover', 'credentials.json');
}

/** Resolve credentials: env first, then ~/.hover/credentials.json. Null when
 *  neither is present (the surfaces show their "connect" hint on null). */
export function readCloudCredentials(
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): CloudCredentials | null {
  if (env.HOVER_CLOUD_TOKEN) {
    return { token: env.HOVER_CLOUD_TOKEN, url: env.HOVER_CLOUD_URL || DEFAULT_CLOUD_URL };
  }
  try {
    const raw = JSON.parse(readFileSync(credentialsPath(home), 'utf8')) as {
      token?: string;
      url?: string;
    };
    if (!raw.token) return null;
    return { token: raw.token, url: raw.url || DEFAULT_CLOUD_URL };
  } catch {
    return null;
  }
}

/** Persist credentials for every local surface (0600 — token, not a secret to
 *  sync; same trust model as ~/.aws/credentials). Returns the path written. */
export function writeCloudCredentials(
  creds: { token: string; url?: string },
  home: string = homedir(),
): string {
  const p = credentialsPath(home);
  mkdirSync(join(home, '.hover'), { recursive: true });
  writeFileSync(p, `${JSON.stringify({ url: DEFAULT_CLOUD_URL, ...creds }, null, 2)}\n`, {
    mode: 0o600,
  });
  return p;
}

/** Raised on a non-2xx cloud response; `status` 401 → token revoked/expired. */
export class CloudApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function cloudJson<T>(
  creds: CloudCredentials,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${creds.url.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CloudApiError(res.status, `${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** The open heal queue (optionally one repo's slice, `owner/name`). */
export async function fetchHealRequests(
  creds: CloudCredentials,
  opts: { status?: 'open' | 'routed' | 'healed' | 'dismissed' | 'all'; repo?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CloudHealRequest[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.repo) params.set('repo', opts.repo);
  const qs = params.size > 0 ? `?${params}` : '';
  const data = await cloudJson<{ healRequests: CloudHealRequest[] }>(
    creds,
    `/api/v1/heal-requests${qs}`,
    {},
    fetchImpl,
  );
  return data.healRequests;
}

/** Mark a request routed (a local heal picked it up) or dismissed / reopened.
 *  `healed` is not writable — only CI seeing the spec pass closes a request. */
export async function updateHealRequest(
  creds: CloudCredentials,
  id: string,
  status: 'routed' | 'dismissed' | 'open',
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await cloudJson(
    creds,
    `/api/v1/heal-requests/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    fetchImpl,
  );
}

/** One project's dashboard, computed cloud-side from ingested CI runs — the
 *  same `DashboardData` shape the local gatherer builds from `.hover/runs`, so
 *  a dashboard surface can swap data sources without a UI change. `repo` is the
 *  GitHub `owner/name` the project was created with. */
export async function fetchDashboard(
  creds: CloudCredentials,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DashboardData> {
  const qs = `?${new URLSearchParams({ repo })}`;
  const data = await cloudJson<{ dashboard: DashboardData }>(
    creds,
    `/api/v1/dashboard${qs}`,
    {},
    fetchImpl,
  );
  return data.dashboard;
}

/** The heal slug for a queued request (`checkout.spec.ts` → `checkout`) — what
 *  `/mcp__hover__heal <slug>` takes. */
export function healSlug(specFile: string): string {
  const base = specFile.split('/').pop() ?? specFile;
  return base.replace(/\.spec\.ts$/, '');
}
