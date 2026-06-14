/**
 * In-extension engine host (Path A — see docs §3.6).
 *
 * The extension spawns `engine/host.mjs` as a child process so the whole Hover
 * engine (`@hover-dev/core`: WS service, agent spawn, Playwright/CDP, MITM,
 * crystallize) runs without a bundler plugin or a separate dev server — install
 * one extension, done. We spawn under VSCode's own Node via `process.execPath`
 * + `ELECTRON_RUN_AS_NODE=1`, so the user needs no system `node`; the engine's
 * deps resolve from the flat `engine/node_modules` shipped in the .vsix.
 *
 * The child prints `HOVER_ENGINE_PORT=<port>` once the WS service binds; the
 * extension's existing WS client pool then connects to that port. Lifecycle is
 * owned here: one engine per window, killed on deactivate.
 */
import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';

let child: ChildProcess | undefined;
let port: number | undefined;
let starting: Promise<number> | undefined;

const START_TIMEOUT_MS = 30_000;

/** Boot the engine for `devRoot` (idempotent). Resolves the bound WS port. */
export function startEngine(ctx: vscode.ExtensionContext, devRoot: string): Promise<number> {
  if (port) return Promise.resolve(port);
  if (starting) return starting;

  const host = ctx.asAbsolutePath('engine/host.mjs');
  starting = new Promise<number>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (err: Error): void => {
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (settled) return;
      settled = true;
      starting = undefined;
      reject(err);
    };

    const cp = spawn(process.execPath, [host], {
      cwd: devRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOVER_DEV_ROOT: devRoot, HOVER_PORT: '51789' },
    });
    child = cp;

    cp.stdout?.on('data', (buf: Buffer) => {
      const m = /HOVER_ENGINE_PORT=(\d+)/.exec(buf.toString());
      if (m && !settled) {
        settled = true;
        if (timer) { clearTimeout(timer); timer = undefined; }
        port = Number(m[1]);
        resolve(port);
      }
    });
    cp.stderr?.on('data', (buf: Buffer) => console.error('[hover-engine]', buf.toString().trimEnd()));
    cp.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))));
    cp.on('exit', (code) => {
      child = undefined;
      port = undefined;
      // Drop the cached promise so a crash (early OR after a clean start) lets
      // the next startEngine() respawn instead of returning the dead port.
      starting = undefined;
      fail(new Error(`engine exited (code ${code ?? 'null'})`));
    });

    // Disarmed only when the port actually arrives (or on fail) — NOT on the
    // first stdout chunk, which may be an unrelated engine log.
    timer = setTimeout(() => fail(new Error('engine start timed out')), START_TIMEOUT_MS);
  });
  return starting;
}

export function stopEngine(): void {
  child?.kill();
  child = undefined;
  port = undefined;
  starting = undefined;
}
