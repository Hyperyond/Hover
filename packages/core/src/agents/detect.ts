import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENTS } from './registry.js';
import type { AgentDescriptor } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Find a binary on PATH. Returns absolute path or null.
 * macOS/Linux uses `which`; Windows uses `where`.
 */
export async function resolveOnPath(binName: string): Promise<string | null> {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(tool, [binName]);
    const first = stdout.split('\n')[0]?.trim();
    return first && first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

export async function resolveBinForAgent(descriptor: AgentDescriptor): Promise<string | null> {
  return resolveOnPath(descriptor.binName);
}

export interface DetectedAgent {
  descriptor: AgentDescriptor;
  binPath: string;
}

/**
 * Scan PATH for every agent in the registry. Returns only the ones found.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const detected: DetectedAgent[] = [];
  for (const descriptor of Object.values(AGENTS)) {
    const binPath = await resolveBinForAgent(descriptor);
    if (binPath) detected.push({ descriptor, binPath });
  }
  return detected;
}
