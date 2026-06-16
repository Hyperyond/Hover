/**
 * In-extension engine host pool (Path A — see docs §3.6).
 *
 * The extension spawns `engine/host.mjs` child processes so the whole Hover
 * engine (`@hover-dev/core`: WS service, agent spawn, Playwright/CDP, MITM,
 * crystallize) runs without a bundler plugin or a separate dev server — install
 * one extension, done. We spawn under VSCode's own Node via `process.execPath`
 * + `ELECTRON_RUN_AS_NODE=1`, so the user needs no system `node`; the engine's
 * deps resolve from the flat `engine/node_modules` shipped in the .vsix.
 *
 * Multi-host model: each chat session drives its OWN browser, so each session
 * gets its OWN engine host on a distinct slot — a distinct CDP port
 * (9222 + slot), Chrome user-data-dir (`hover-chrome-<slot>`, isolated logins),
 * and WS port (51789 + slot, the service auto-bumps within the pool range on
 * conflict). Hosts spawn lazily on first use and are capped at MAX_HOSTS; when
 * the cap is hit we evict the least-recently-used idle host (its Chrome closes
 * with it). Each child prints `HOVER_ENGINE_PORT=<port>` once its WS service
 * binds; the extension's WS client pool connects to that exact port and routes
 * each session's run to its host. Lifecycle is owned here, killed on deactivate.
 */
import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Hard cap on concurrent engine hosts (≈ concurrent browsers / runs). Each
 *  host is its own Node process + Chrome, so this bounds RAM. User-chosen. */
const MAX_HOSTS = 4;
const BASE_CDP_PORT = 9222;
const BASE_WS_PORT = 51789;
const START_TIMEOUT_MS = 30_000;

interface Host {
  slot: number;
  child: ChildProcess;
  enginePort: number;
  cdpUrl: string;
  sessionId: string;
  lastUsed: number;
}

export interface EngineInfo {
  enginePort: number;
  cdpUrl: string;
  slot: number;
}

/** slot → live host. */
const hosts = new Map<number, Host>();
/** sessionId → in-flight spawn (dedupe concurrent acquires for one session). */
const starting = new Map<string, Promise<EngineInfo>>();
let monotonic = 0;

const hostForSession = (sessionId: string): Host | undefined => {
  for (const h of hosts.values()) if (h.sessionId === sessionId) return h;
  return undefined;
};

export function portForSession(sessionId: string): number | undefined {
  return hostForSession(sessionId)?.enginePort;
}

export function sessionForPort(port: number): string | undefined {
  for (const h of hosts.values()) if (h.enginePort === port) return h.sessionId;
  return undefined;
}

export function liveEngineCount(): number {
  return hosts.size;
}

/** Pick a free slot, or evict the LRU idle host (one not in `busy`) to free one.
 *  Returns null when every slot is held by a busy session. Async because evicting
 *  AWAITS the old host's exit — its shutdown closes the slot's Chrome (same CDP
 *  port + profile the reused slot will relaunch), so without the wait a parallel
 *  spawn could attach to the previous session's logged-in browser. */
async function allocSlot(busy: Set<string>): Promise<number | null> {
  for (let s = 0; s < MAX_HOSTS; s++) if (!hosts.has(s)) return s;
  // Full — evict the least-recently-used host whose session isn't running.
  let victim: Host | undefined;
  for (const h of hosts.values()) {
    if (busy.has(h.sessionId)) continue;
    if (!victim || h.lastUsed < victim.lastUsed) victim = h;
  }
  if (!victim) return null;
  const slot = victim.slot;
  await killHostAndWait(slot);
  return slot;
}

function killHost(slot: number): void {
  const h = hosts.get(slot);
  if (!h) return;
  hosts.delete(slot);
  try { h.child.kill(); } catch { /* already gone */ }
}

/** Kill a host and wait for it to actually exit (its Chrome closes on the way
 *  out), so the slot's CDP port + profile are free before reuse. Bounded so a
 *  wedged child can't stall a new run forever. */
function killHostAndWait(slot: number, timeoutMs = 6000): Promise<void> {
  const h = hosts.get(slot);
  if (!h) return Promise.resolve();
  hosts.delete(slot);
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => { if (done) return; done = true; clearTimeout(t); resolve(); };
    const t = setTimeout(finish, timeoutMs);
    h.child.once('exit', finish);
    try { h.child.kill(); } catch { finish(); }
  });
}

/** Get (or lazily spawn) the engine host serving `sessionId`. Reuses the
 *  session's existing host; otherwise allocates a slot (evicting an idle host
 *  if at the cap) and spawns one. `busy` = sessions with a run in flight, which
 *  are never evicted. Rejects when all slots are busy. */
export function acquireEngine(
  ctx: vscode.ExtensionContext,
  devRoot: string,
  sessionId: string,
  opts: { busy?: Set<string> } = {},
): Promise<EngineInfo> {
  const existing = hostForSession(sessionId);
  if (existing) {
    existing.lastUsed = ++monotonic;
    return Promise.resolve({ enginePort: existing.enginePort, cdpUrl: existing.cdpUrl, slot: existing.slot });
  }
  const inFlight = starting.get(sessionId);
  if (inFlight) return inFlight;

  // Register the in-flight spawn SYNCHRONOUSLY (before the first await in the
  // IIFE) so concurrent acquires for the same session dedupe onto this promise.
  const p = (async (): Promise<EngineInfo> => {
    const slot = await allocSlot(opts.busy ?? new Set());
    if (slot == null) {
      throw new Error(`All ${MAX_HOSTS} browsers are busy — wait for a run to finish before starting another session.`);
    }
    const cdpUrl = `http://localhost:${BASE_CDP_PORT + slot}`;
    const userDataDir = join(tmpdir(), `hover-chrome-${slot}`);
    const host = ctx.asAbsolutePath('engine/host.mjs');

    return await new Promise<EngineInfo>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (err: Error): void => {
        if (timer) { clearTimeout(timer); timer = undefined; }
        if (settled) return;
        settled = true;
        reject(err);
      };

      const cp = spawn(process.execPath, [host], {
        cwd: devRoot,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          HOVER_DEV_ROOT: devRoot,
          HOVER_PORT: String(BASE_WS_PORT + slot),
          HOVER_CDP_URL: cdpUrl,
          HOVER_USER_DATA_DIR: userDataDir,
        },
      });

      cp.stdout?.on('data', (buf: Buffer) => {
        const m = /HOVER_ENGINE_PORT=(\d+)/.exec(buf.toString());
        if (m && !settled) {
          settled = true;
          if (timer) { clearTimeout(timer); timer = undefined; }
          const enginePort = Number(m[1]);
          hosts.set(slot, { slot, child: cp, enginePort, cdpUrl, sessionId, lastUsed: ++monotonic });
          resolve({ enginePort, cdpUrl, slot });
        }
      });
      cp.stderr?.on('data', (buf: Buffer) => console.error(`[hover-engine:${slot}]`, buf.toString().trimEnd()));
      cp.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))));
      cp.on('exit', (code) => {
        // Drop the (possibly already-registered) host so the next acquire respawns.
        if (hosts.get(slot)?.child === cp) hosts.delete(slot);
        fail(new Error(`engine exited (code ${code ?? 'null'})`));
      });

      timer = setTimeout(() => fail(new Error('engine start timed out')), START_TIMEOUT_MS);
    });
  })();

  starting.set(sessionId, p);
  // Clear the in-flight entry however it settles, so a later acquire respawns.
  void p.catch(() => {}).finally(() => { if (starting.get(sessionId) === p) starting.delete(sessionId); });
  return p;
}

/** Kill the host serving `sessionId` (e.g. its session was deleted). Its Chrome
 *  closes with it (the service tears down its per-session Chrome on close). */
export function releaseSession(sessionId: string): void {
  const h = hostForSession(sessionId);
  if (h) killHost(h.slot);
}

/** Kill every host (deactivate). */
export function stopEngine(): void {
  for (const slot of [...hosts.keys()]) killHost(slot);
  starting.clear();
}
