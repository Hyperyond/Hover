/**
 * Cross-platform launcher for an isolated debug Chrome on a known CDP port.
 *
 * Idempotent — if the port already responds, returns immediately. Used by:
 *   - `pnpm smoke:chrome` (monorepo) via src/scripts/start-chrome.ts
 *   - `pnpm exec hover-chrome` (npm consumers) via @hyperyond/vite-plugin's bin
 *
 * The user-data-dir is isolated under tmpdir so we never touch the user's
 * primary Chrome profile.
 */
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LaunchOptions {
  /** CDP port to expose (default 9222). */
  port?: number;
  /** Isolated user-data-dir (default `<tmpdir>/hover-chrome`). */
  userDataDir?: string;
  /** Initial URL (default 'about:blank'). */
  url?: string;
  /** How long to wait for /json/version to respond (default 9000ms). */
  readyTimeoutMs?: number;
  /** Poll interval while waiting (default 300ms). */
  pollMs?: number;
}

export type LaunchResult =
  | { ok: true; alreadyRunning: boolean; userDataDir: string; port: number }
  | { ok: false; reason: string };

const DEFAULT_PORT = 9222;
const DEFAULT_READY_TIMEOUT_MS = 9000;
const DEFAULT_POLL_MS = 300;

export function findChromeBinary(): string | null {
  const candidates: string[] = [];

  switch (platform()) {
    case 'darwin':
      candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      if (process.env.HOME) {
        candidates.push(
          join(process.env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        );
      }
      candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
      break;

    case 'win32': {
      const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
      const localAppData = process.env['LOCALAPPDATA'];
      candidates.push(join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      if (localAppData) {
        candidates.push(join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      }
      // Edge fallback (Chromium-based, supports --remote-debugging-port too)
      candidates.push(join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      break;
    }

    default:
      candidates.push('/usr/bin/google-chrome');
      candidates.push('/usr/bin/google-chrome-stable');
      candidates.push('/usr/bin/chromium');
      candidates.push('/usr/bin/chromium-browser');
      candidates.push('/snap/bin/chromium');
      break;
  }

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

async function isCdpAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * If a previous Chrome instance crashed it can leave SingletonLock files in the
 * user-data-dir. Stale locks prevent the next launch from binding cleanly.
 */
function clearStaleProfileLock(dir: string): void {
  for (const file of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = join(dir, file);
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Start (or detect) a debug Chrome listening on the given CDP port. Detaches
 * the child process so the calling script can exit cleanly while Chrome keeps
 * running.
 */
export async function launchDebugChrome(opts: LaunchOptions = {}): Promise<LaunchResult> {
  const port = opts.port ?? DEFAULT_PORT;
  const userDataDir = opts.userDataDir ?? join(tmpdir(), 'hover-chrome');
  const url = opts.url ?? 'about:blank';
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;

  if (await isCdpAlive(port)) {
    return { ok: true, alreadyRunning: true, userDataDir, port };
  }

  const chrome = findChromeBinary();
  if (!chrome) {
    return {
      ok: false,
      reason: `Chrome not found in any standard location for ${platform()}`,
    };
  }

  clearStaleProfileLock(userDataDir);

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ];

  const child = spawn(chrome, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  const spawnError: { err: Error | null } = { err: null };
  child.on('error', err => {
    spawnError.err = err;
  });
  child.unref();

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, pollMs));
    if (spawnError.err) {
      return { ok: false, reason: `failed to spawn Chrome: ${spawnError.err.message}` };
    }
    if (await isCdpAlive(port)) {
      return { ok: true, alreadyRunning: false, userDataDir, port };
    }
  }

  return {
    ok: false,
    reason: `Chrome started but /json/version did not respond within ${readyTimeoutMs}ms`,
  };
}
