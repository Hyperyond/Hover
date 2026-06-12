/**
 * Atlas — the persistent graph of verified operation paths, accumulated as a
 * side effect of crystallization. Nodes are normalized routes; edges are
 * agent-verified navigations / interactions, with provenance back to the spec
 * slugs whose sessions verified them.
 *
 * Iron rules (same as the sidecar):
 *   - Derived ONLY from the structured `SkillStep[]` — never parsed back out
 *     of generated `.spec.ts` code.
 *   - Merge failures must never break Save-as-spec: callers wrap
 *     `mergeAtlasFromSteps` in try/catch and log; a corrupt `atlas.json` is
 *     renamed aside and rebuilt from scratch (sidecars remain the source of
 *     truth for a future `hover atlas rebuild`).
 *
 * Consumers, in design order: agent navigation grounding (S2), the local
 * console (S3), Hover Cloud sync (S4). See
 * docs/superpowers/specs/2026-06-12-hover-dir-atlas-design.md.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillStep } from '../skills/writeSkill.js';
import { humanStep } from '../specs/humanSteps.js';
import { hoverDir } from '../specs/sidecar.js';

export const ATLAS_VERSION = 1;

export interface Atlas {
  version: number;
  /** Dev-server origin the in-app node ids are relative to. */
  origin: string;
  /** ISO timestamp of the last merge. */
  updatedAt: string;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
}

export interface AtlasNode {
  /** Normalized path ("/checkout") for same-origin routes; full
   *  origin-prefixed URL for cross-origin pages (popup flows). Hash and query
   *  are stripped; dynamic segments stay literal in v1 ("/product/3"). */
  id: string;
  /** data-hover-source refs ("<rel-path>:<line>:<col>") observed on elements
   *  interacted with at this node. Empty when the captured inputs carry none. */
  sources: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface AtlasEdge {
  /** Dedup identity: `${from}|${to}|${kind}|${label}`. */
  id: string;
  from: string;
  to: string;
  /** "navigate" = URL changed; "action" = verified in-page interaction. */
  kind: 'navigate' | 'action';
  /** Human label, e.g. `Click Add to cart button` (humanStep prose). Labels
   *  never carry typed input VALUES — `humanStep` output for browser_type is
   *  re-reduced to the element description so secrets typed during a session
   *  (passwords) cannot land in a committed atlas. */
  label: string;
  /** Spec slugs whose sessions verified this edge. */
  specs: string[];
  /** Times observed across all merges. */
  count: number;
  lastSeen: string;
}

/** One session's contribution, pre-merge. */
export interface AtlasDelta {
  origin: string;
  nodes: Array<Pick<AtlasNode, 'id' | 'sources'>>;
  edges: Array<Pick<AtlasEdge, 'id' | 'from' | 'to' | 'kind' | 'label'>>;
}

export function atlasPath(devRoot: string): string {
  return join(hoverDir(devRoot), 'atlas.json');
}

/** Tools that count as verified in-page interactions (action edges). Mirrors
 *  the replayable set in writeSpec/humanSteps; diagnostics are excluded. */
const INTERACTION_TOOLS = new Set([
  'browser_click',
  'browser_double_click',
  'browser_hover',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
]);

/** Normalize a captured URL to a node id: same-origin → bare pathname
 *  (trailing slash collapsed, query + hash dropped); cross-origin → full
 *  origin + pathname. Returns null for unparseable URLs. */
export function normalizeNodeId(rawUrl: string, origin: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return u.origin === origin ? path : `${u.origin}${path}`;
}

/** Privacy-reducing edge label: for typing tools, drop the typed value and
 *  keep only the target element; otherwise use the humanStep prose. */
function edgeLabel(tool: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  if (tool === 'browser_type') {
    const el = typeof i.element === 'string' && i.element ? i.element : 'field';
    return `Type into ${el}`;
  }
  if (tool === 'browser_fill_form') {
    const fields = (i.fields as Array<{ name?: string; element?: string }> | undefined) ?? [];
    const names = fields.map(f => f.name ?? f.element ?? 'field');
    return names.length ? `Fill ${names.join(', ')}` : null;
  }
  return humanStep(tool, input);
}

/** Opportunistically harvest data-hover-source refs from a captured input
 *  (element descriptions / refs sometimes embed them). */
function harvestSources(input: unknown): string[] {
  const out: string[] = [];
  const re = /data-hover-source="([^"]+)"|(?:^|[\s('"`])((?:[\w@.-]+\/)+[\w.-]+\.\w{1,5}:\d+:\d+)/g;
  let m: RegExpExecArray | null;
  const text = JSON.stringify(input ?? '');
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? m[2]!);
  return out;
}

/**
 * Walk one session's structured steps into an AtlasDelta. Returns null when
 * the session never navigated (no node context to attach anything to).
 */
export function deriveAtlasDelta(steps: SkillStep[]): AtlasDelta | null {
  // Origin = origin of the first navigated URL.
  let origin: string | null = null;
  for (const s of steps) {
    if (s.kind !== 'step' || s.tool !== 'browser_navigate') continue;
    const url = String((s.input as Record<string, unknown> | undefined)?.url ?? '');
    try {
      origin = new URL(url).origin;
      break;
    } catch {
      /* keep looking */
    }
  }
  if (!origin) return null;

  const nodes = new Map<string, Set<string>>(); // id → sources
  const edges = new Map<string, AtlasDelta['edges'][number]>();
  const touchNode = (id: string, sources: string[] = []) => {
    const set = nodes.get(id) ?? new Set<string>();
    for (const src of sources) set.add(src);
    nodes.set(id, set);
  };
  const addEdge = (from: string, to: string, kind: AtlasEdge['kind'], label: string) => {
    const id = `${from}|${to}|${kind}|${label}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, kind, label });
  };

  let current: string | null = null;
  for (const s of steps) {
    if (s.kind !== 'step' || !s.tool) continue;
    const input = (s.input ?? {}) as Record<string, unknown>;
    if (s.tool === 'browser_navigate') {
      const to = normalizeNodeId(String(input.url ?? ''), origin);
      if (!to) continue;
      touchNode(to);
      if (current && current !== to) addEdge(current, to, 'navigate', `Open ${to}`);
      current = to;
      continue;
    }
    if (!INTERACTION_TOOLS.has(s.tool) || !current) continue;
    const label = edgeLabel(s.tool, s.input);
    if (!label) continue;
    touchNode(current, harvestSources(s.input));
    // v1: interactions are self-edges. A click that *causes* a route change
    // (SPA pushState) is invisible to the step stream — the captured inputs
    // carry no post-action URL — so we don't guess a target node.
    addEdge(current, current, 'action', label);
  }

  return {
    origin,
    nodes: [...nodes.entries()].map(([id, sources]) => ({ id, sources: [...sources].sort() })),
    edges: [...edges.values()],
  };
}

/** Read `.hover/atlas.json`; a corrupt file is renamed aside (never deleted)
 *  and treated as absent. */
async function readAtlas(devRoot: string): Promise<Atlas | null> {
  const path = atlasPath(devRoot);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    const a = JSON.parse(raw) as Atlas;
    if (a.version === ATLAS_VERSION && Array.isArray(a.nodes) && Array.isArray(a.edges)) return a;
  } catch {
    /* fall through to quarantine */
  }
  try {
    await rename(path, `${path}.corrupt-${Date.now()}`);
  } catch {
    /* best effort */
  }
  return null;
}

/**
 * Merge one session's delta into `.hover/atlas.json` (pure set-union by id;
 * existing entries bump count / lastSeen and union sources / specs). Atomic
 * write (tmp → rename). Returns the absolute path written.
 */
export async function mergeAtlas(
  devRoot: string,
  delta: AtlasDelta,
  specSlug?: string,
): Promise<string> {
  const now = new Date().toISOString();
  const atlas: Atlas = (await readAtlas(devRoot)) ?? {
    version: ATLAS_VERSION,
    origin: delta.origin,
    updatedAt: now,
    nodes: [],
    edges: [],
  };

  const nodeById = new Map(atlas.nodes.map(n => [n.id, n]));
  for (const dn of delta.nodes) {
    const existing = nodeById.get(dn.id);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, ...dn.sources])].sort();
      existing.lastSeen = now;
    } else {
      nodeById.set(dn.id, { id: dn.id, sources: dn.sources, firstSeen: now, lastSeen: now });
    }
  }

  const edgeById = new Map(atlas.edges.map(e => [e.id, e]));
  for (const de of delta.edges) {
    const existing = edgeById.get(de.id);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      if (specSlug && !existing.specs.includes(specSlug)) existing.specs.push(specSlug);
    } else {
      edgeById.set(de.id, { ...de, specs: specSlug ? [specSlug] : [], count: 1, lastSeen: now });
    }
  }

  atlas.nodes = [...nodeById.values()];
  atlas.edges = [...edgeById.values()];
  atlas.updatedAt = now;

  const path = atlasPath(devRoot);
  await mkdir(hoverDir(devRoot), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(atlas, null, 2) + '\n', 'utf-8');
  await rename(tmp, path);
  return path;
}

/** Convenience wrapper for the save flow: derive + merge in one call. No-op
 *  (returns null) when the session never navigated. NEVER throws — atlas
 *  accumulation is best-effort and must not break Save-as-spec; failures are
 *  reported via the return value for the caller to log. */
export async function mergeAtlasFromSteps(
  devRoot: string,
  steps: SkillStep[],
  specSlug?: string,
): Promise<{ path: string } | { error: string } | null> {
  try {
    const delta = deriveAtlasDelta(steps);
    if (!delta) return null;
    return { path: await mergeAtlas(devRoot, delta, specSlug) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
