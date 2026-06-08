import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

vi.mock('node:os', () => ({ platform: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { platform } from 'node:os';
import { spawn } from 'node:child_process';
import { findCdpPid, raiseChromeWindow } from '../../src/playwright/raiseWindow.js';

interface FakeChild extends EventEmitter {
  stdout: Readable;
}

function mockSpawn(stdoutText: string, exitCode = 0): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = Readable.from([stdoutText]);
  // Defer 'close' to the next tick so callers can attach listeners first.
  setImmediate(() => child.emit('close', exitCode));
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findCdpPid', () => {
  it('parses lsof output on darwin', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(spawn).mockReturnValue(mockSpawn('54321\n') as unknown as ReturnType<typeof spawn>);

    const pid = await findCdpPid(9222);

    expect(pid).toBe(54321);
    expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('lsof');
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(['-tiTCP:9222', '-sTCP:LISTEN']);
  });

  it('parses lsof output on linux', async () => {
    vi.mocked(platform).mockReturnValue('linux');
    vi.mocked(spawn).mockReturnValue(mockSpawn('12345\n') as unknown as ReturnType<typeof spawn>);

    const pid = await findCdpPid(9222);

    expect(pid).toBe(12345);
    expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('lsof');
  });

  it('parses netstat output on win32', async () => {
    vi.mocked(platform).mockReturnValue('win32');
    const netstatOut = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    127.0.0.1:9222         0.0.0.0:0              LISTENING       7777',
      '  TCP    127.0.0.1:9999         0.0.0.0:0              LISTENING       8888',
    ].join('\n');
    vi.mocked(spawn).mockReturnValue(mockSpawn(netstatOut) as unknown as ReturnType<typeof spawn>);

    const pid = await findCdpPid(9222);

    expect(pid).toBe(7777);
  });

  it('returns null when nothing is listening', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(spawn).mockReturnValue(mockSpawn('') as unknown as ReturnType<typeof spawn>);

    const pid = await findCdpPid(9222);

    expect(pid).toBe(null);
  });

  it('returns null when the helper fails to spawn', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    const child = new EventEmitter() as FakeChild;
    child.stdout = Readable.from([]);
    setImmediate(() => child.emit('error', new Error('ENOENT: lsof')));
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const pid = await findCdpPid(9222);

    expect(pid).toBe(null);
  });
});

describe('raiseChromeWindow', () => {
  it('uses osascript with PID match on darwin', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(spawn).mockReturnValue(mockSpawn('') as unknown as ReturnType<typeof spawn>);

    await raiseChromeWindow(54321);

    const [cmd, args] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect(cmd).toBe('osascript');
    expect(args?.[0]).toBe('-e');
    expect(args?.[1]).toContain('unix id is 54321');
    expect(args?.[1]).toContain('System Events');
  });

  it('maps PID to window id then uses wmctrl with -ia on linux', async () => {
    vi.mocked(platform).mockReturnValue('linux');
    // First call is `wmctrl -l -p` (listing); we return a window owned by the
    // target PID. Second call is the `-ia <window-id>` raise.
    const listing = [
      '0x03c00001  0 999    host  Some Other Window',
      '0x03c00007  0 12345  host  Hover Debug Chrome',
    ].join('\n');
    vi.mocked(spawn)
      .mockReturnValueOnce(mockSpawn(listing) as unknown as ReturnType<typeof spawn>)
      .mockReturnValueOnce(mockSpawn('') as unknown as ReturnType<typeof spawn>);

    await raiseChromeWindow(12345);

    const [listCmd, listArgs] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect(listCmd).toBe('wmctrl');
    expect(listArgs).toEqual(['-l', '-p']);

    const [cmd, args] = vi.mocked(spawn).mock.calls[1] ?? [];
    expect(cmd).toBe('wmctrl');
    expect(args).toEqual(['-ia', '0x03c00007']);
  });

  it('no-ops when no wmctrl window matches the PID on linux', async () => {
    vi.mocked(platform).mockReturnValue('linux');
    const listing = '0x03c00001  0 999  host  Some Other Window';
    vi.mocked(spawn).mockReturnValue(mockSpawn(listing) as unknown as ReturnType<typeof spawn>);

    await raiseChromeWindow(12345);

    // Only the listing call happened; no raise call.
    expect(vi.mocked(spawn).mock.calls.length).toBe(1);
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(['-l', '-p']);
  });

  it('uses powershell AppActivate on win32', async () => {
    vi.mocked(platform).mockReturnValue('win32');
    vi.mocked(spawn).mockReturnValue(mockSpawn('') as unknown as ReturnType<typeof spawn>);

    await raiseChromeWindow(7777);

    const [cmd, args] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect(cmd).toBe('powershell');
    expect(args?.join(' ')).toContain('AppActivate');
    expect(args?.join(' ')).toContain('7777');
  });

  it('swallows spawn errors so a missing helper does not throw', async () => {
    vi.mocked(platform).mockReturnValue('linux');
    const child = new EventEmitter() as FakeChild;
    child.stdout = Readable.from([]);
    setImmediate(() => child.emit('error', new Error('ENOENT: wmctrl')));
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    await expect(raiseChromeWindow(42)).resolves.toBeUndefined();
  });

  it('does nothing on unknown platforms', async () => {
    vi.mocked(platform).mockReturnValue('freebsd' as NodeJS.Platform);

    await raiseChromeWindow(42);

    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});
