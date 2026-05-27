/**
 * Raise the OS-level Chrome window to the foreground.
 *
 * Why this exists: CDP's `Page.bringToFront()` and `Target.activateTarget`
 * only reorder tabs *inside* the Chrome process — they do not raise the
 * Chrome application window in the OS's window stack. When the user clicks
 * "Switch me to it" from a widget hosted in a different window, the tab
 * activates correctly inside the (possibly background) debug Chrome, but
 * the window stays buried. The user then has to manually click the Chrome
 * Dock icon / Alt-Tab to it, which defeats the point of the button.
 *
 * Fix: after `bringToFront()`, run an OS-specific command that raises the
 * specific Chrome *process* (matched by PID, found from the CDP port via
 * `lsof` / `netstat`). PID-matching is critical — the user's own primary
 * Chrome and Hover's debug Chrome are both "Google Chrome" to AppleScript,
 * so raising by app name would risk activating the wrong window.
 *
 * Best-effort and non-blocking — if the helper fails, we still leave the
 * tab correctly focused inside the debug Chrome and the user can click
 * over manually like before. Logging is to stderr only; this never throws
 * back to the caller.
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Find the OS PID of the process listening on the given TCP port.
 * Returns null if nothing is listening or the lookup tool isn't available.
 */
export async function findCdpPid(port: number): Promise<number | null> {
  const os = platform();

  if (os === 'darwin' || os === 'linux') {
    // -t prints just PIDs, -sTCP:LISTEN filters to listeners (otherwise
    // every client connection's PID would show up too).
    const out = await runCapture('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN']);
    if (!out) return null;
    // lsof may print multiple lines if forked workers also hold the port;
    // take the first numeric one.
    for (const line of out.split('\n')) {
      const pid = Number.parseInt(line.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    return null;
  }

  if (os === 'win32') {
    // `netstat -ano` columns: Proto Local Foreign State PID
    const out = await runCapture('netstat', ['-ano']);
    if (!out) return null;
    for (const line of out.split('\n')) {
      // Match `TCP    127.0.0.1:9222    0.0.0.0:0    LISTENING    1234`
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (m && Number(m[1]) === port) return Number(m[2]);
    }
    return null;
  }

  return null;
}

/**
 * Raise the Chrome window owned by `pid` to the OS foreground. Best-effort.
 */
export async function raiseChromeWindow(pid: number): Promise<void> {
  const os = platform();

  try {
    if (os === 'darwin') {
      // System Events can frontmost any process by its unix PID, regardless
      // of app bundle. This works even when several "Google Chrome"
      // processes coexist (user's primary + Hover's debug).
      await runDetached('osascript', [
        '-e',
        `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
      ]);
      return;
    }

    if (os === 'linux') {
      // wmctrl is the most common helper for X11; not always installed,
      // but the alternative (xdotool) needs the same dependency story.
      // We try wmctrl with the PID match; if it isn't installed the
      // outer try/catch swallows the ENOENT and we degrade gracefully.
      await runDetached('wmctrl', ['-ia', String(pid)]);
      return;
    }

    if (os === 'win32') {
      // PowerShell is bundled with Windows 10+. AppActivate is best-effort:
      // it requires the target to have a visible main window, which a
      // headless-less Chrome with a tab open satisfies.
      const ps = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
        `if ($p) { ` +
        `  Add-Type -AssemblyName Microsoft.VisualBasic; ` +
        `  [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) ` +
        `}`;
      await runDetached('powershell', ['-NoProfile', '-Command', ps]);
      return;
    }
  } catch {
    // Best-effort. CDP-level bringToFront already ran; user can still
    // click the Chrome window manually.
  }
}

function runCapture(cmd: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    let out = '';
    let settled = false;
    const finish = (v: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', chunk => {
      out += chunk.toString();
    });
    child.on('error', () => finish(null));
    child.on('close', code => finish(code === 0 ? out : null));
  });
}

function runDetached(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      // Don't treat non-zero as fatal — caller already wraps in try/catch.
      resolve();
    });
  });
}
