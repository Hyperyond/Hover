/**
 * Cross-platform "start debug Chrome on port 9222" launcher.
 *
 * Replaces the macOS-only scripts/smoke-chrome.sh. Same behaviour:
 *   - Idempotent: if 9222 already responds, exits 0 without touching anything.
 *   - Forces a separate Chrome process with an isolated user-data-dir so the
 *     --remote-debugging-port flag actually takes effect (on macOS, `open`
 *     would otherwise join the existing user-launched Chrome and silently
 *     drop --args).
 *   - Detaches the child so the script exits cleanly while Chrome keeps
 *     running.
 *
 * Run via `pnpm smoke:chrome` from the repo root.
 */
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const CDP = 'http://localhost:9222';
const DATA_DIR = join(tmpdir(), 'hover-smoke');
const READY_TIMEOUT_MS = 9000;
const POLL_MS = 300;

function findChrome(): string | null {
  const candidates: string[] = [];

  switch (platform()) {
    case 'darwin':
      candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      if (process.env.HOME) {
        candidates.push(
          join(process.env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        );
      }
      // Chromium fallback
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
      // linux / other
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

async function isCdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * If a previous Chrome instance crashed, it may leave a SingletonLock in the
 * user-data-dir. New Chrome won't start cleanly with that lock present.
 * Removing it is safer than pkill-by-cmdline (which is OS-specific).
 */
function clearStaleProfileLock(): void {
  for (const file of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = join(DATA_DIR, file);
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

async function main(): Promise<void> {
  if (await isCdpAlive()) {
    console.log('[hover:chrome] already listening on 9222');
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error(
      `[hover:chrome] Chrome not found in any standard location for ${platform()}`,
    );
    process.exit(1);
  }

  clearStaleProfileLock();

  const args = [
    '--remote-debugging-port=9222',
    `--user-data-dir=${DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ];

  const child = spawn(chrome, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  child.on('error', err => {
    console.error(`[hover:chrome] failed to spawn: ${err.message}`);
    process.exit(1);
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, POLL_MS));
    if (await isCdpAlive()) {
      console.log(`[hover:chrome] ready on 9222 (data-dir=${DATA_DIR})`);
      return;
    }
  }

  console.error(
    `[hover:chrome] timeout: Chrome started but /json/version did not respond within ${READY_TIMEOUT_MS}ms`,
  );
  process.exit(1);
}

main().catch(err => {
  console.error('[hover:chrome] error:', err);
  process.exit(1);
});
