/**
 * Atlas digest — the compact, prompt-ready rendering of `.hover/atlas.json`
 * for agent navigation grounding (S2 of the atlas design doc).
 *
 * Why: the most common token waste observed in sessions is the agent
 * re-deriving the app's shape — navigating around to discover routes it (or a
 * teammate) already verified in a prior session. The digest hands it the known
 * map up front: route inventory + the most-verified navigation paths and
 * interactions.
 *
 * Shipping posture: injected on the FIRST turn only (same prompt-cache
 * reasoning as conventions.md — resume turns must keep the system prompt
 * byte-identical), and gated behind `HOVER_ATLAS_GROUNDING=1` until the
 * bench-ttfb A/B proves it pays for its own tokens. Data decides the default.
 */
import { readFile } from 'node:fs/promises';
import { atlasPath, type Atlas, type AtlasEdge } from './atlas.js';

/** Hard cap on the digest's size — grounding must never crowd out the task. */
const MAX_CHARS = 2_000;

/** Most-verified edges to list. Routes are cheap (one line); edges are the
 *  bulk, so they're ranked by observation count and truncated. */
const MAX_EDGES = 25;

/**
 * Render the atlas into a system-prompt block, or null when there is no atlas
 * (or it is empty / unreadable). Never throws.
 */
export async function buildAtlasDigest(devRoot: string): Promise<string | null> {
  let atlas: Atlas;
  try {
    atlas = JSON.parse(await readFile(atlasPath(devRoot), 'utf-8')) as Atlas;
  } catch {
    return null;
  }
  if (!Array.isArray(atlas.nodes) || !Array.isArray(atlas.edges) || atlas.nodes.length === 0) {
    return null;
  }

  const routes = atlas.nodes.map(n => n.id).sort();
  const ranked = [...atlas.edges].sort((a, b) => b.count - a.count).slice(0, MAX_EDGES);
  const navigations = ranked.filter(e => e.kind === 'navigate');
  const actions = ranked.filter(e => e.kind === 'action');

  const lines = [
    `## Known app map (verified in prior Hover sessions — may be stale, trust the live page over this)`,
    `Routes seen: ${routes.join(', ')}`,
  ];
  if (navigations.length > 0) {
    lines.push(`Verified navigations:`);
    for (const e of navigations) lines.push(`- ${e.from} → ${e.to} (×${e.count})`);
  }
  if (actions.length > 0) {
    lines.push(`Verified interactions:`);
    for (const e of actions) lines.push(formatAction(e));
  }
  lines.push(
    `Use this map to go directly to the right route instead of exploring. Do not assume it is complete.`,
  );

  let out = lines.join('\n');
  if (out.length > MAX_CHARS) out = `${out.slice(0, MAX_CHARS - 1)}…`;
  return out;
}

function formatAction(e: AtlasEdge): string {
  return `- on ${e.from}: ${e.label} (×${e.count})`;
}
