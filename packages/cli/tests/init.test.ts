import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit, HOVER_COMMAND_MD } from '../src/init.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hover-init-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  // best-effort cleanup
  for (const d of dirs.splice(0)) {
    try {
      require('node:fs').rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const opts = (cwd: string) => ({ cwd, target: 'http://localhost:5173', mcpCommand: '/usr/bin/node', mcpArgs: ['/abs/mcp.js'] });

describe('runInit', () => {
  it('writes a .mcp.json registering the hover server + the /hover command', () => {
    const cwd = tmp();
    const res = runInit(opts(cwd));

    expect(res.files).toHaveLength(2);
    const cfg = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    expect(cfg.mcpServers.hover).toMatchObject({
      command: '/usr/bin/node',
      args: ['/abs/mcp.js'],
      env: { HOVER_TARGET: 'http://localhost:5173', HOVER_PROJECT_ROOT: cwd },
    });

    const cmd = readFileSync(join(cwd, '.claude', 'commands', 'hover.md'), 'utf8');
    expect(cmd).toBe(HOVER_COMMAND_MD);
    expect(cmd).toContain('crystallize_spec');
    expect(cmd).toContain('record==replay');
    // phased / scale-aware workflow
    expect(cmd).toContain('.hover/hover-map.md');
    expect(cmd).toContain('Phase 1');
    expect(cmd).toContain('Map the business lines');
  });

  it('merges into an existing .mcp.json without clobbering other servers', () => {
    const cwd = tmp();
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    runInit(opts(cwd));

    const cfg = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    expect(cfg.mcpServers.other).toEqual({ command: 'x' }); // preserved
    expect(cfg.mcpServers.hover).toBeDefined();
  });

  it('recovers from an unparseable .mcp.json by writing a fresh one', () => {
    const cwd = tmp();
    writeFileSync(join(cwd, '.mcp.json'), '{ not json');
    runInit(opts(cwd));
    const cfg = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    expect(cfg.mcpServers.hover).toBeDefined();
  });

  it('is idempotent', () => {
    const cwd = tmp();
    runInit(opts(cwd));
    runInit(opts(cwd));
    const cfg = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    expect(Object.keys(cfg.mcpServers)).toEqual(['hover']);
    expect(existsSync(join(cwd, '.claude', 'commands', 'hover.md'))).toBe(true);
  });
});
