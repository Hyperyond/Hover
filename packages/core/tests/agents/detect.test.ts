import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:child_process.execFile so `resolveOnPath` doesn't really shell out
// for `which claude` / `which codex` — the host machine might or might not
// have either installed, and we want deterministic per-test scenarios.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import {
  detectAgents,
  listAgentAvailability,
  pickPrimaryAgent,
} from '../../src/agents/detect.js';

type InstalledMap = Record<string, string>;

/**
 * Stub `which` / `where` to behave as if only the given bins are on PATH.
 * detect.ts wraps execFile in promisify, so we have to honour the (cmd, args,
 * callback) signature node uses, NOT the promisified signature.
 */
function stubInstalled(installed: InstalledMap) {
  vi.mocked(execFile).mockImplementation(((
    _cmd: string,
    args: readonly string[],
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    const bin = args[0]!;
    const path = installed[bin];
    if (path) {
      callback(null, { stdout: `${path}\n`, stderr: '' });
    } else {
      callback(new Error(`${bin} not found`));
    }
    return {} as ReturnType<typeof execFile>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}

beforeEach(() => {
  vi.mocked(execFile).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectAgents', () => {
  it('returns only the installed agents, in registry order', async () => {
    stubInstalled({ claude: '/usr/local/bin/claude' });
    const detected = await detectAgents();
    expect(detected.map((d) => d.descriptor.id)).toEqual(['claude']);
    expect(detected[0]?.binPath).toBe('/usr/local/bin/claude');
  });

  it('returns both when both are installed, in registry order (claude first)', async () => {
    stubInstalled({
      claude: '/usr/local/bin/claude',
      codex: '/usr/local/bin/codex',
    });
    const detected = await detectAgents();
    expect(detected.map((d) => d.descriptor.id)).toEqual(['claude', 'codex']);
  });

  it('returns [] when none are installed', async () => {
    stubInstalled({});
    expect(await detectAgents()).toEqual([]);
  });
});

describe('listAgentAvailability', () => {
  it('lists every registered agent with installed/missing flags', async () => {
    stubInstalled({ claude: '/usr/local/bin/claude' });
    const list = await listAgentAvailability();
    const claude = list.find((a) => a.id === 'claude')!;
    const codex = list.find((a) => a.id === 'codex')!;
    expect(claude.installed).toBe(true);
    expect(claude.sandboxStrength).toBe('hard');
    expect(claude.label).toBe('Claude Code');
    expect(codex.installed).toBe(false);
    expect(codex.sandboxStrength).toBe('soft');
    expect(codex.installHint).toContain('@openai/codex');
  });
});

describe('pickPrimaryAgent', () => {
  it('honors the preferred id when installed', async () => {
    stubInstalled({
      codex: '/usr/local/bin/codex',
      claude: '/usr/local/bin/claude',
    });
    const picked = await pickPrimaryAgent('codex');
    expect(picked?.descriptor.id).toBe('codex');
  });

  it('falls back to the first installed agent in registry order when preference is missing', async () => {
    stubInstalled({ codex: '/usr/local/bin/codex' });
    const picked = await pickPrimaryAgent('claude');
    expect(picked?.descriptor.id).toBe('codex');
  });

  it('returns null when no agent is installed', async () => {
    stubInstalled({});
    const picked = await pickPrimaryAgent('claude');
    expect(picked).toBe(null);
  });

  it('does not require preferredId — uses first installed', async () => {
    stubInstalled({ claude: '/usr/local/bin/claude' });
    const picked = await pickPrimaryAgent();
    expect(picked?.descriptor.id).toBe('claude');
  });

  it('ignores an unknown preferred id', async () => {
    stubInstalled({ claude: '/usr/local/bin/claude' });
    const picked = await pickPrimaryAgent('made-up-agent');
    expect(picked?.descriptor.id).toBe('claude');
  });
});
