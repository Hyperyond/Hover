import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENTS, listAgents } from './registry.js';
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
 * Scan PATH for every agent in the registry. Returns only the ones found,
 * in registry insertion order.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const detected: DetectedAgent[] = [];
  for (const descriptor of listAgents()) {
    const binPath = await resolveBinForAgent(descriptor);
    if (binPath) detected.push({ descriptor, binPath });
  }
  return detected;
}

export interface AgentAvailability {
  id: string;
  label: string;
  tagline?: string;
  sandboxStrength: 'hard' | 'soft';
  installed: boolean;
  binPath?: string;
  homepage?: string;
  installHint?: string;
}

/**
 * Like `detectAgents`, but also includes registered-but-not-installed agents
 * so the widget can render them dimmed with an install hint. Order matches
 * the registry.
 */
export async function listAgentAvailability(): Promise<AgentAvailability[]> {
  const result: AgentAvailability[] = [];
  for (const descriptor of listAgents()) {
    const binPath = await resolveBinForAgent(descriptor);
    result.push({
      id: descriptor.id,
      label: descriptor.display.label,
      tagline: descriptor.display.tagline,
      sandboxStrength: descriptor.sandboxStrength,
      installed: binPath != null,
      binPath: binPath ?? undefined,
      homepage: descriptor.display.homepage,
      installHint: descriptor.display.installHint,
    });
  }
  return result;
}

/**
 * Pick the agent we should default to when the user / Vite plugin didn't
 * specify one. Prefer the explicit hint if it's installed; otherwise the
 * first registered agent that's installed; finally null if nothing matches.
 *
 * `preferredId` is typically `process.env.HOVER_AGENT` or the value the user
 * picked in the widget last session (persisted by the widget to localStorage).
 */
export async function pickPrimaryAgent(preferredId?: string): Promise<DetectedAgent | null> {
  if (preferredId) {
    const descriptor = AGENTS[preferredId];
    if (descriptor) {
      const binPath = await resolveBinForAgent(descriptor);
      if (binPath) return { descriptor, binPath };
    }
  }
  const detected = await detectAgents();
  return detected[0] ?? null;
}
