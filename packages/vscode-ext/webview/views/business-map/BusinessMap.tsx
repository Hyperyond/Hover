import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { post, onMessage } from "../../shared/vscode";

/**
 * Business Map — a graph of the app's business lines + test coverage, parsed
 * from `.hover/hover-map.md` (the wiki the Hover MCP maintains) by the extension
 * (src/businessMapView.ts) and pushed over `{type:'data', graph}`. The agent
 * authors the map; here you SEE it and act on it:
 *   • click a spec node → open the file
 *   • click a line node → open its route in the browser
 *   • select a line → toolbar: Open route / Run spec (covered) / Ask agent (uncovered)
 *   • search / "uncovered only" / layout (horizontal ↔ vertical)
 * Line + spec nodes color by their latest run (pass/fail/flaky) when known,
 * else by coverage (covered/uncovered).
 */

type Kind = "app" | "area" | "line" | "spec";
type Run = "pass" | "fail" | "flaky";
type RelationKind = "depends-on" | "shares-state" | "navigates-to";
type Severity = "error" | "warn" | "info";
interface LintFinding {
  kind: "deleted-spec" | "regressed-coverage" | "orphan-spec";
  severity: Severity;
  message: string;
  line?: string;
  spec?: string;
  fix?: string;
}
interface WikiLogEntry {
  iso: string;
  kind: string;
  summary: string;
}
interface MapNode {
  id: string;
  label: string;
  kind: Kind;
  status?: "covered" | "uncovered";
  route?: string;
  spec?: string;
  path?: string;
  run?: Run;
  lintFindings?: LintFinding[];
}
interface Graph {
  app: string;
  nodes: MapNode[];
  edges: { source: string; target: string }[];
  relations?: { source: string; target: string; kind: RelationKind }[];
  stats: { lines: number; covered: number; areas: number };
  lint?: { ok: boolean; findings: LintFinding[] };
  timeline?: WikiLogEntry[];
}

type Layout = "horizontal" | "vertical";
const COL: Record<Kind, number> = { app: 0, area: 1, line: 2, spec: 3 };
const COL_X = 240;
const ROW_Y = 56;

const RUN_VAR: Record<Run, string> = {
  pass: "var(--vscode-testing-iconPassed, var(--vscode-charts-green))",
  fail: "var(--vscode-testing-iconFailed, var(--vscode-charts-red))",
  flaky: "var(--vscode-testing-iconQueued, var(--vscode-charts-yellow))",
};

// Inter-line relationship edges (LLM-Wiki P2) — one color per kind, drawn dashed
// so they read as distinct from the app→area→line→spec hierarchy edges.
const REL_VAR: Record<RelationKind, string> = {
  "depends-on": "var(--vscode-charts-blue)",
  "shares-state": "var(--vscode-charts-purple)",
  "navigates-to": "var(--vscode-charts-orange)",
};
const REL_LABEL: Record<RelationKind, string> = {
  "depends-on": "depends",
  "shares-state": "shares",
  "navigates-to": "navigates",
};
const SEV_VAR: Record<Severity, string> = {
  error: "var(--vscode-testing-iconFailed, var(--vscode-charts-red))",
  warn: "var(--vscode-testing-iconQueued, var(--vscode-charts-yellow))",
  info: "var(--vscode-descriptionForeground)",
};
/** The worst error/warn severity among a node's findings (info is not badged). */
function worstSeverity(fs?: LintFinding[]): "error" | "warn" | undefined {
  if (!fs?.length) return undefined;
  if (fs.some((f) => f.severity === "error")) return "error";
  if (fs.some((f) => f.severity === "warn")) return "warn";
  return undefined;
}

function nodeStyle(n: MapNode, selected: boolean): React.CSSProperties {
  // A lint error/warn on this line rings it (selection still wins the ring).
  const drift = worstSeverity(n.lintFindings);
  const base: React.CSSProperties = {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--vscode-panel-border)",
    background: "var(--vscode-editorWidget-background)",
    color: "var(--vscode-foreground)",
    width: 190,
    boxShadow: selected
      ? "0 0 0 2px var(--vscode-focusBorder)"
      : drift
        ? `0 0 0 2px ${SEV_VAR[drift]}`
        : undefined,
  };
  if (n.kind === "app") return { ...base, fontWeight: 700, borderColor: "var(--vscode-focusBorder)" };
  if (n.kind === "area") return { ...base, fontWeight: 600 };
  if (n.kind === "spec") {
    const border = n.run ? RUN_VAR[n.run] : "var(--vscode-charts-blue)";
    return { ...base, borderColor: border, fontFamily: "var(--vscode-editor-font-family)", fontSize: 11 };
  }
  // line — color by run if known, else by coverage.
  if (n.run) return { ...base, borderColor: RUN_VAR[n.run] };
  const covered = n.status === "covered";
  return {
    ...base,
    borderColor: covered ? "var(--vscode-testing-iconPassed, var(--vscode-charts-green))" : "var(--vscode-disabledForeground)",
    opacity: covered ? 1 : 0.7,
  };
}

const RUN_MARK: Record<Run, string> = { pass: "✓ ", fail: "✗ ", flaky: "~ " };
function label(n: MapNode): string {
  if (n.kind === "line") {
    const mark = n.run ? RUN_MARK[n.run] : n.status === "covered" ? "✓ " : "○ ";
    const drift = worstSeverity(n.lintFindings) ? " ⚠" : "";
    return mark + n.label + drift + (n.route ? `  ${n.route}` : "");
  }
  return n.label;
}

function toFlow(graph: Graph, layout: Layout, selectedId: string | null): { nodes: Node[]; edges: Edge[] } {
  const rows: Partial<Record<Kind, number>> = {};
  const horizontal = layout === "horizontal";
  const nodes: Node[] = graph.nodes.map((n) => {
    const row = rows[n.kind] ?? 0;
    rows[n.kind] = row + 1;
    const col = COL[n.kind];
    // horizontal: kind = column (x), instances stack (y).
    // vertical:   kind = row (y), instances spread (x).
    const position = horizontal
      ? { x: col * COL_X, y: row * ROW_Y }
      : { x: row * COL_X, y: col * (ROW_Y * 1.8) };
    return {
      id: n.id,
      position,
      data: { label: label(n), path: n.path, kind: n.kind, route: n.route },
      style: nodeStyle(n, n.id === selectedId),
      sourcePosition: horizontal ? "right" : "bottom",
      targetPosition: horizontal ? "left" : "top",
      draggable: true,
    } as Node;
  });
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    style: { stroke: "var(--vscode-panel-border)" },
  }));
  // Inter-line relationship edges — dashed + colored per kind, labeled.
  const present = new Set(nodes.map((n) => n.id));
  const relEdges: Edge[] = (graph.relations ?? [])
    .filter((r) => present.has(r.source) && present.has(r.target))
    .map((r, i) => ({
      id: `rel${i}`,
      source: r.source,
      target: r.target,
      label: REL_LABEL[r.kind],
      style: { stroke: REL_VAR[r.kind], strokeDasharray: "5 4" },
      labelStyle: { fontSize: 9, fill: REL_VAR[r.kind] },
      labelBgStyle: { fill: "var(--vscode-editor-background)", fillOpacity: 0.85 },
    }));
  return { nodes, edges: [...edges, ...relEdges] };
}

/** Keep a filtered subgraph connected: every kept line drags in its area + app
 *  ancestors and its spec descendants. */
function filterGraph(graph: Graph, query: string, uncoveredOnly: boolean): Graph {
  const q = query.trim().toLowerCase();
  if (!q && !uncoveredOnly) return graph;

  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of graph.edges) {
    const kids = childrenOf.get(e.source) ?? [];
    kids.push(e.target);
    childrenOf.set(e.source, kids);
    parentOf.set(e.target, e.source);
  }

  const keep = new Set<string>();
  const keepWithAncestors = (id: string): void => {
    let cur: string | undefined = id;
    while (cur) {
      keep.add(cur);
      cur = parentOf.get(cur);
    }
  };
  const keepWithDescendants = (id: string): void => {
    keep.add(id);
    for (const c of childrenOf.get(id) ?? []) keepWithDescendants(c);
  };

  for (const n of graph.nodes) {
    if (n.kind !== "line") continue;
    if (uncoveredOnly && n.status === "covered") continue;
    if (q && !n.label.toLowerCase().includes(q)) continue;
    keepWithAncestors(n.id);
    keepWithDescendants(n.id);
  }

  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  const relations = (graph.relations ?? []).filter((r) => keep.has(r.source) && keep.has(r.target));
  const covered = nodes.filter((n) => n.kind === "line" && n.status === "covered").length;
  const lines = nodes.filter((n) => n.kind === "line").length;
  const areas = nodes.filter((n) => n.kind === "area").length;
  // lint + timeline are global (not subject to the flow filter) — pass through.
  return { app: graph.app, nodes, edges, relations, stats: { lines, covered, areas }, lint: graph.lint, timeline: graph.timeline };
}

const CTRL: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 4,
  border: "1px solid var(--vscode-panel-border)",
  background: "var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background))",
  color: "var(--vscode-button-secondaryForeground, var(--vscode-foreground))",
  cursor: "pointer",
};

export function BusinessMap() {
  const [graph, setGraph] = useState<Graph | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const [layout, setLayout] = useState<Layout>("horizontal");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "issues" | "history">(null);

  useEffect(() => {
    const off = onMessage((m) => {
      if (m.type === "data") setGraph((m.graph as Graph) ?? null);
    });
    post({ type: "ready" });
    return off;
  }, []);

  const filtered = useMemo(
    () => (graph ? filterGraph(graph, query, uncoveredOnly) : null),
    [graph, query, uncoveredOnly],
  );
  const { nodes, edges } = useMemo(
    () => (filtered ? toFlow(filtered, layout, selectedId) : { nodes: [], edges: [] }),
    [filtered, layout, selectedId],
  );

  const selected = useMemo(
    () => (graph && selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null),
    [graph, selectedId],
  );

  if (graph === undefined) return <Center>Loading…</Center>;
  if (graph === null)
    return (
      <Center>
        No business map yet.
        <br />
        Run <code>/mcp__hover__test_app</code> in your agent to map this app.
      </Center>
    );

  const stats = filtered?.stats ?? graph.stats;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {/* Top control bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "6px 10px",
          borderBottom: "1px solid var(--vscode-panel-border)",
          fontSize: 11,
        }}
      >
        <strong style={{ fontSize: 12 }}>{graph.app}</strong>
        <span style={{ opacity: 0.7 }}>
          · {stats.covered}/{stats.lines} flows · {stats.areas} areas
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter flows…"
          style={{
            fontSize: 11,
            padding: "3px 6px",
            borderRadius: 4,
            border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
            background: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            minWidth: 120,
          }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={uncoveredOnly} onChange={(e) => setUncoveredOnly(e.target.checked)} />
          Uncovered only
        </label>
        <button style={CTRL} onClick={() => setLayout((l) => (l === "horizontal" ? "vertical" : "horizontal"))}>
          {layout === "horizontal" ? "Horizontal ↔" : "Vertical ↕"}
        </button>
        {graph.lint && graph.lint.findings.length > 0 && (
          <button
            style={{ ...CTRL, borderColor: SEV_VAR[worstSeverity(graph.lint.findings) ?? "info"] }}
            onClick={() => setPanel((p) => (p === "issues" ? null : "issues"))}
            title="Wiki lint findings"
          >
            ⚠ {graph.lint.findings.length}
          </button>
        )}
        {graph.timeline && graph.timeline.length > 0 && (
          <button style={CTRL} onClick={() => setPanel((p) => (p === "history" ? null : "history"))} title="Run history (.hover/log.md)">
            History
          </button>
        )}
        <Legend />
      </div>

      {/* Selected-line action toolbar */}
      {selected && selected.kind === "line" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px",
            borderBottom: "1px solid var(--vscode-panel-border)",
            background: "var(--vscode-editorWidget-background)",
            fontSize: 11,
          }}
        >
          <span style={{ opacity: 0.85, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selected.label}
          </span>
          {selected.route && (
            <button style={CTRL} onClick={() => post({ type: "openRoute", route: selected.route })}>
              Open route
            </button>
          )}
          {selected.path ? (
            <button style={CTRL} onClick={() => post({ type: "runSpec", path: selected.path })}>
              Run spec
            </button>
          ) : (
            <button style={CTRL} onClick={() => post({ type: "handoff", line: selected.label })}>
              Ask agent to cover
            </button>
          )}
        </div>
      )}

      {panel === "issues" && graph.lint && (
        <DrawerPanel title="Wiki issues" onClose={() => setPanel(null)}>
          {graph.lint.findings.length === 0 ? (
            <em style={{ opacity: 0.7 }}>No drift — every mapped spec exists, no covered line is failing.</em>
          ) : (
            graph.lint.findings.map((f, i) => (
              <div key={i} style={{ marginTop: 5 }}>
                <span style={{ color: SEV_VAR[f.severity] }}>
                  {f.severity === "error" ? "✗" : f.severity === "warn" ? "⚠" : "·"}
                </span>{" "}
                <span style={{ opacity: 0.6 }}>[{f.kind}]</span> {f.message}
                {f.fix ? <div style={{ opacity: 0.6, marginLeft: 16 }}>→ {f.fix}</div> : null}
              </div>
            ))
          )}
        </DrawerPanel>
      )}
      {panel === "history" && graph.timeline && (
        <DrawerPanel title="Recent activity" onClose={() => setPanel(null)}>
          {graph.timeline.length === 0 ? (
            <em style={{ opacity: 0.7 }}>No run history yet.</em>
          ) : (
            graph.timeline
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={i} style={{ marginTop: 3, opacity: 0.85 }}>
                  <span style={{ opacity: 0.55 }}>{fmtTime(e.iso)}</span> · <b>{e.kind}</b> · {e.summary}
                </div>
              ))
          )}
        </DrawerPanel>
      )}

      <div style={{ position: "relative", flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => {
            const d = node.data as { path?: string; kind?: Kind; route?: string };
            setSelectedId(node.id);
            if (d.kind === "spec" && d.path) post({ type: "open", path: d.path });
            else if (d.kind === "line" && d.route) post({ type: "openRoute", route: d.route });
          }}
          onPaneClick={() => setSelectedId(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

function Legend() {
  const item = (color: string, text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, border: `2px solid ${color}`, display: "inline-block" }} />
      {text}
    </span>
  );
  // A dashed swatch for relationship-edge kinds.
  const rel = (color: string, text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span style={{ width: 12, borderTop: `2px dashed ${color}`, display: "inline-block" }} />
      {text}
    </span>
  );
  return (
    <span style={{ display: "inline-flex", gap: 8, marginLeft: "auto", opacity: 0.8, flexWrap: "wrap" }}>
      {item(RUN_VAR.pass, "pass")}
      {item(RUN_VAR.fail, "fail")}
      {item(RUN_VAR.flaky, "flaky")}
      {item("var(--vscode-testing-iconPassed, var(--vscode-charts-green))", "covered")}
      {item("var(--vscode-disabledForeground)", "uncovered")}
      {rel(REL_VAR["depends-on"], "depends")}
      {rel(REL_VAR["shares-state"], "shares")}
      {rel(REL_VAR["navigates-to"], "navigates")}
    </span>
  );
}

/** ISO → short local time (falls back to the raw string if unparseable). */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A dismissible drawer strip below the toolbars (lint issues / run history). */
function DrawerPanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        borderBottom: "1px solid var(--vscode-panel-border)",
        background: "var(--vscode-editorWidget-background)",
        padding: "6px 10px",
        maxHeight: 160,
        overflowY: "auto",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
        <strong style={{ fontSize: 11 }}>{title}</strong>
        <button style={{ ...CTRL, marginLeft: "auto", padding: "1px 6px" }} onClick={onClose}>
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 20, textAlign: "center", color: "var(--vscode-descriptionForeground)", lineHeight: 1.6 }}>
      {children}
    </div>
  );
}
