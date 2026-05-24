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
 *
 * Probes all agents in parallel — each `which`/`where` call is ~50-200ms
 * and the registry's growth target is 7-10 agents, so serial would noticeably
 * lag the first widget hello / agent-dropdown open.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const descriptors = listAgents();
  const paths = await Promise.all(descriptors.map(d => resolveBinForAgent(d)));
  return descriptors.flatMap((descriptor, i) => {
    const binPath = paths[i];
    return binPath ? [{ descriptor, binPath }] : [];
  });
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
 * the registry. Probes run in parallel — see `detectAgents`.
 */
export async function listAgentAvailability(): Promise<AgentAvailability[]> {
  const descriptors = listAgents();
  const paths = await Promise.all(descriptors.map(d => resolveBinForAgent(d)));
  return descriptors.map((descriptor, i) => {
    const binPath = paths[i];
    return {
      id: descriptor.id,
      label: descriptor.display.label,
      tagline: descriptor.display.tagline,
      sandboxStrength: descriptor.sandboxStrength,
      installed: binPath != null,
      binPath: binPath ?? undefined,
      homepage: descriptor.display.homepage,
      installHint: descriptor.display.installHint,
    };
  });
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
