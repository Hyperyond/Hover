/*
 * Business-map parser for the cockpit's graph view. Turns the
 * `.hover/hover-map.md` wiki the agent maintains into a graph model
 * (app → area → business line → spec, with coverage).
 *
 * Copied from packages/core/src/specs/businessMap.ts (the canonical, unit-tested
 * version) and kept in-extension on purpose: it's a ~tiny pure parser with no
 * deps, and the extension bundles its own src (it must not depend on the staged
 * engine for a read-only view). Keep the two in sync if the map format changes.
 */

// Lint findings + log entries are attached by the provider (via
// @hover-dev/core/wiki) as VIEW enrichment — not produced by the parser here.
import type { LintFinding, WikiLogEntry } from '@hover-dev/core/wiki';
export type { LintFinding, WikiLogEntry };

export type MapNodeKind = 'app' | 'area' | 'line' | 'spec';
export type CoverageStatus = 'covered' | 'uncovered';
export type RunStatus = 'pass' | 'fail' | 'flaky';
/** Inter-line relationship kinds from the map's `## Relationships` block. */
export type RelationKind = 'depends-on' | 'shares-state' | 'navigates-to';

export interface MapNode {
  id: string;
  label: string;
  kind: MapNodeKind;
  status?: CoverageStatus;
  route?: string;
  spec?: string;
  /** Absolute fsPath of the spec file, resolved by the provider (spec + line nodes). */
  path?: string;
  /** Latest run outcome for this node's spec, from `.hover/runs/*.json`
   *  (resolved by the provider). On line nodes = worst of their specs. */
  run?: RunStatus;
  /** Lint drift touching this line (attached by the provider from lintWiki). */
  lintFindings?: LintFinding[];
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
  /** Wiki lint result (attached by the provider; undefined until gathered). */
  lint?: { ok: boolean; findings: LintFinding[] };
  /** Recent run-history entries from `.hover/log.md` (newest last). */
  timeline?: WikiLogEntry[];
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
  const lineBySlug = new Map<string, string>();
  const rawRelations: { source: string; kind: RelationKind; target: string }[] = [];

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const areaM = line.match(/^##\s+(.+)$/);
    if (areaM) {
      const label = areaM[1].trim();
      // The Relationships block is metadata, not an area — its items are edges,
      // not business lines (don't node them).
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

  const relations: MapRelation[] = [];
  for (const r of rawRelations) {
    const source = lineBySlug.get(slug(r.source));
    const target = lineBySlug.get(slug(r.target));
    if (source && target && source !== target) relations.push({ source, target, kind: r.kind });
  }

  return { app, nodes, edges, relations, stats: { lines: lineCount, covered, areas: areaCount } };
}

/**
 * Render the map as a Mermaid flowchart — the shareable projection. GitHub /
 * GitLab / Notion render `mermaid` fences natively, so this makes the business
 * map (and its coverage) visible to people WITHOUT Hover: paste into a README,
 * a PR description, a doc. Export-only: the checklist stays the source of
 * truth (coverage semantics don't round-trip through a diagram).
 *
 * Coloring: green = spec passing, red = failing, amber = flaky,
 * outlined green = covered but not run yet, dashed = uncovered.
 */
export function businessMapToMermaid(graph: BusinessMapGraph): string {
  // Mermaid-safe label: quoted string; `"` becomes the #quot; entity.
  const esc = (s: string): string => s.replace(/"/g, '#quot;').replace(/\s+/g, ' ').trim();
  // Stable short ids — graph node ids may contain characters mermaid rejects.
  const mid = new Map<string, string>();
  const idOf = (nodeId: string): string => {
    let m = mid.get(nodeId);
    if (!m) {
      m = `n${mid.size}`;
      mid.set(nodeId, m);
    }
    return m;
  };

  const lines: string[] = ['flowchart LR'];
  const classes: string[] = [];

  for (const n of graph.nodes) {
    if (n.kind === 'spec') continue; // the line node carries the state — keep the diagram readable
    const id = idOf(n.id);
    // API contract lines (the `## API` area) render as hexagons — the second
    // perspective, distinguishable at a glance from UI-flow lines.
    const isApi = n.kind === 'line' && /\.api-test\.spec\.tsx?$/.test(n.spec ?? '');
    if (n.kind === 'app') lines.push(`  ${id}(["${esc(n.label)}"])`);
    else if (n.kind === 'area') lines.push(`  ${id}["${esc(n.label)}"]`);
    else if (isApi) lines.push(`  ${id}{{"${esc(n.label)}"}}`);
    else lines.push(`  ${id}("${esc(n.label)}")`);
    if (n.kind === 'line') {
      const cls = n.run ?? (n.status === 'covered' ? 'covered' : 'uncovered');
      classes.push(`  class ${id} ${cls}`);
    }
  }

  for (const e of graph.edges) {
    if (!mid.has(e.source) || !mid.has(e.target)) continue; // skips spec edges
    lines.push(`  ${idOf(e.source)} --> ${idOf(e.target)}`);
  }
  for (const r of graph.relations) {
    if (!mid.has(r.source) || !mid.has(r.target)) continue;
    lines.push(`  ${idOf(r.source)} -.->|${r.kind}| ${idOf(r.target)}`);
  }

  lines.push(
    '  classDef pass fill:#D3E8DC,stroke:#2C6E49,color:#20261C',
    '  classDef fail fill:#F3D9D3,stroke:#B4472F,color:#20261C',
    '  classDef flaky fill:#F6E8C8,stroke:#B58A2A,color:#20261C',
    '  classDef covered fill:#EAF2EC,stroke:#2C6E49,color:#20261C',
    '  classDef uncovered fill:#F5F1E8,stroke:#B58A2A,stroke-dasharray: 4 3,color:#54594C',
    ...classes,
    `  %% Generated by Hover (gethover.dev) — green: tested & passing · red: failing · amber: flaky · dashed: not covered yet`,
  );
  return lines.join('\n');
}
