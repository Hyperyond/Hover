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
export interface BusinessMapGraph {
  app: string;
  nodes: MapNode[];
  edges: MapEdge[];
  stats: { lines: number; covered: number; areas: number };
}

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
  let covered = 0;
  let lineCount = 0;
  let areaCount = 0;

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const areaM = line.match(/^##\s+(.+)$/);
    if (areaM) {
      const label = areaM[1].trim();
      const id = `area:${slug(label)}`;
      area = { id };
      add({ id, label, kind: 'area' });
      edges.push({ source: 'app', target: id });
      areaCount++;
      continue;
    }
    const itemM = line.match(/^\s*-\s*\[([ xX])\]\s+(.+)$/);
    if (itemM) {
      const status: CoverageStatus = itemM[1].toLowerCase() === 'x' ? 'covered' : 'uncovered';
      const { name, route, spec } = splitItem(itemM[2]);
      const parentId = area?.id ?? 'app';
      const lineId = `line:${slug(area ? area.id.slice(5) : 'top')}/${slug(name)}`;
      add({ id: lineId, label: name, kind: 'line', status, route, spec });
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

  return { app, nodes, edges, stats: { lines: lineCount, covered, areas: areaCount } };
}
