import { useEffect, useState } from "react";
import { post, onMessage } from "../../shared/vscode";
import "./dashboard.css";

/**
 * Dashboard view — React port of the former string-template dashboardView. The
 * data layer (gather / Playwright-report parsing) stays in src/dashboardView.ts
 * and pushes a `DashboardData` over `{type:'data'}`. Same outbound protocol:
 * runAll / runSpec / optimize / open / ready.
 */

type Status = "pass" | "fail" | "flaky";
interface SpecRow {
  name: string;
  path: string | null;
  group: string;
  security: boolean;
  cells: (Status | null)[];
}
interface DashboardData {
  hasRuns: boolean;
  tiles: { specs: number; passRate: number | null; flaky: number; tokens7d: number };
  runs: { id: string; ts: string }[];
  rows: SpecRow[];
}

const fmtTok = (n: number) => {
  n = n || 0;
  if (n < 1000) return `${n}`;
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
};

const Shield = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M8 2l5 2v3.5c0 3-2.1 5.3-5 6.3C5.1 12.8 3 10.5 3 7.5V4l5-2z" /></svg>);
const Beaker = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M6 2v4L3 12.5a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L10 6V2M5 2h6" /></svg>);
const Play = () => (<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z" /></svg>);
const Sparkle = () => (<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" /></svg>);
const Folder = () => (<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4.5h4l1.2 1.5H14v6.5H2z" /></svg>);

function Tile({ n, k, cls }: { n: string | number; k: string; cls?: string }) {
  return (<div className="tile"><div className={"n " + (cls || "")}>{n}</div><div className="k">{k}</div></div>);
}

function Row({ r }: { r: SpecRow }) {
  return (
    <div className="row">
      <span className="ic">{r.security ? <Shield /> : <Beaker />}</span>
      {r.path ? (
        <span className="nm" title={r.name} onClick={() => post({ type: "open", path: r.path! })}>{r.name}</span>
      ) : (
        <span className="nm" style={{ cursor: "default" }} title="not on disk">{r.name}</span>
      )}
      <span className="cells">
        {r.cells.map((c, i) => (<span key={i} className={"sq " + (c || "")} />))}
      </span>
      {r.path && (
        <span className="acts">
          <button className="iact" title="Run" onClick={() => post({ type: "runSpec", path: r.path! })}><Play /></button>
          <button className="iact" title="Optimize" onClick={() => post({ type: "optimize", path: r.path! })}><Sparkle /></button>
        </span>
      )}
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const off = onMessage((m) => { if (m.type === "data") setData(m.data as DashboardData); });
    post({ type: "ready" });
    return off;
  }, []);

  const t = data?.tiles;
  const rate = !t || t.passRate == null ? "—" : `${t.passRate}%`;
  const rateCls = !t || t.passRate == null ? "" : t.passRate >= 90 ? "ok" : t.passRate >= 60 ? "warn" : "bad";

  const ql = q.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter((r) => !ql || r.name.toLowerCase().includes(ql));
  // Group by folder, '' (top level) first.
  const groups: Record<string, SpecRow[]> = {};
  const order: string[] = [];
  rows.forEach((r) => { if (!(r.group in groups)) { groups[r.group] = []; order.push(r.group); } groups[r.group].push(r); });
  order.sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));

  return (
    <div className="dashboard">
      <button className="runall" onClick={() => post({ type: "runAll" })}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z" /></svg> Run all specs
      </button>
      <div className="search">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" /></svg>
        <input type="text" placeholder="Search specs…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!data ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          <div className="tiles">
            <Tile n={t!.specs} k="specs" />
            <Tile n={rate} k="last pass rate" cls={rateCls} />
            <Tile n={t!.flaky} k="flaky" cls={t!.flaky ? "warn" : ""} />
            <Tile n={fmtTok(t!.tokens7d)} k="tokens · 7d" />
          </div>
          {rows.length === 0 ? (
            <div className="empty" dangerouslySetInnerHTML={{ __html: data.rows.length ? "No specs match." : "No specs yet.<br/>Drive your app with Hover to crystallize one." }} />
          ) : (
            <>
              <h3>Specs</h3>
              {order.map((g) => (
                <div key={g || "__top"}>
                  {g && <div className="group"><Folder />{g}</div>}
                  {groups[g].map((r) => (<Row key={(r.path || "") + r.name} r={r} />))}
                </div>
              ))}
              <div className="legend">
                <span><i style={{ background: "var(--pass)" }} />pass</span>
                <span><i style={{ background: "var(--fail)" }} />fail</span>
                <span><i style={{ background: "var(--flaky)" }} />flaky</span>
                <span><i style={{ background: "var(--line)" }} />not run</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
