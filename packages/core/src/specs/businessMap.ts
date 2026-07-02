/*
 * Canonical parser for the `.hover/hover-map.md` business map the agent
 * maintains — the overview page of the app's living test wiki. Turns the
 * markdown checklist into a graph model (app → area → business line → spec,
 * with coverage).
 *
 * This is the unit-tested source of truth. The cockpit keeps an in-extension
 * copy (packages/vscode-ext/src/businessMap.ts) on purpose — a read-only view
 * must not depend on the engine — so keep the two in sync if the format changes.
 */

export type MapNodeKind = 'app' | 'area' | 'line' | 'spec';
export type CoverageStatus = 'covered' | 'uncovered';
/** Inter-line relationship kinds recorded in the map's `## Relationships` block
 *  (LLM-Wiki P2) — the graph edges that aren't the app→area→line→spec hierarchy. */
export type RelationKind = 'depends-on' | 'shares-state' | 'navigates-to';

export interface MapNode {
  id: string;
  label: string;
  kind: MapNodeKind;
  status?: CoverageStatus;
  route?: string;
  spec?: string;
}
export interface MapEdge {
  source: string;
  target: string;
}
/** A resolved inter-line edge: source/target are `line:` node ids. */
export interface MapRelation {
  source: string;
  target: string;
  kind: RelationKind;
}
export interface BusinessMapGraph {
  app: string;
  nodes: MapNode[];
  edges: MapEdge[];
  /** Inter-line relationships from the `## Relationships` block (may be empty). */
  relations: MapRelation[];
  stats: { lines: number; covered: number; areas: number };
}

const RELATION_KINDS: readonly RelationKind[] = ['depends-on', 'shares-state', 'navigates-to'];
const RELATION_RE = new RegExp(`^\\s*-\\s+(.+?)\\s+(${RELATION_KINDS.join('|')})\\s+(.+?)\\s*$`);

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

const SPEC_RE = /\.spec\.tsx?$/;

function splitItem(rest: string): { name: string; route?: string; spec?: string } {
  const parts = rest
    .split(/\s+[—–-]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const name = parts.shift() ?? rest.trim();
  let route: string | undefined;
  let spec: string | undefined;
  for (const p of parts) {
    if (SPEC_RE.test(p)) spec = p;
    else if (p.startsWith('/')) route = p;
  }
  return { name, route, spec };
}

export function parseBusinessMap(md: string, fallbackApp = 'app'): BusinessMapGraph {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  const add = (n: MapNode): void => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };

  let app = fallbackApp;
  const title = md.match(/^#\s+(.+)$/m);
  if (title) {
    const t = title[1].trim();
    const m = t.match(/business\s*map\s*[—–-]\s*(.+)$/i);
    app = (m ? m[1] : t).trim() || fallbackApp;
  }
  add({ id: 'app', label: app, kind: 'app' });

  let area: { id: string } | null = null;
  let inRelationships = false;
  let covered = 0;
  let lineCount = 0;
  let areaCount = 0;
  // name-slug → line node id, so the `## Relationships` block can resolve a line
  // by its label regardless of which area it sits under. First-defined wins.
  const lineBySlug = new Map<string, string>();
  const rawRelations: { source: string; kind: RelationKind; target: string }[] = [];

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const areaM = line.match(/^##\s+(.+)$/);
    if (areaM) {
      const label = areaM[1].trim();
      // The Relationships block is metadata, not an area — don't node it; its
      // items are edges (parsed below), not business lines.
      if (slug(label) === 'relationships') {
        inRelationships = true;
        area = null;
        continue;
      }
      inRelationships = false;
      const id = `area:${slug(label)}`;
      area = { id };
      add({ id, label, kind: 'area' });
      edges.push({ source: 'app', target: id });
      areaCount++;
      continue;
    }
    if (inRelationships) {
      const relM = line.match(RELATION_RE);
      if (relM) rawRelations.push({ source: relM[1].trim(), kind: relM[2] as RelationKind, target: relM[3].trim() });
      continue;
    }
    const itemM = line.match(/^\s*-\s*\[([ xX])\]\s+(.+)$/);
    if (itemM) {
      const status: CoverageStatus = itemM[1].toLowerCase() === 'x' ? 'covered' : 'uncovered';
      const { name, route, spec } = splitItem(itemM[2]);
      const parentId = area?.id ?? 'app';
      const lineId = `line:${slug(area ? area.id.slice(5) : 'top')}/${slug(name)}`;
      add({ id: lineId, label: name, kind: 'line', status, route, spec });
      if (!lineBySlug.has(slug(name))) lineBySlug.set(slug(name), lineId);
      edges.push({ source: parentId, target: lineId });
      lineCount++;
      if (status === 'covered') covered++;
      if (spec) {
        const specId = `spec:${spec}`;
        add({ id: specId, label: spec, kind: 'spec', spec });
        edges.push({ source: lineId, target: specId });
      }
    }
  }

  // Resolve relationships against the lines now that all are known; an edge whose
  // endpoints don't both name a known line is dropped (a stale/typo'd reference).
  const relations: MapRelation[] = [];
  for (const r of rawRelations) {
    const source = lineBySlug.get(slug(r.source));
    const target = lineBySlug.get(slug(r.target));
    if (source && target && source !== target) relations.push({ source, target, kind: r.kind });
  }

  return { app, nodes, edges, relations, stats: { lines: lineCount, covered, areas: areaCount } };
}
