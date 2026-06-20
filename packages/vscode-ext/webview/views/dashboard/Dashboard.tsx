import { useEffect, useState } from "react";
import { post, onMessage } from "../../shared/vscode";

/**
 * Dashboard view. The data layer (gather / Playwright-report parsing) lives in
 * src/dashboardView.ts and pushes a `DashboardData` over `{type:'data'}`. Same
 * outbound protocol: runAll / runSpec / optimize / open / ready. Styled with
 * Tailwind utilities (see webview/theme.css).
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
const Play = () => (<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M4 3l9 5-9 5z" /></svg>);
const Sparkle = () => (<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" /></svg>);
const Folder = () => (<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="opacity-70"><path d="M2 4.5h4l1.2 1.5H14v6.5H2z" /></svg>);

const TILE_CLS: Record<string, string> = { ok: "text-pass", bad: "text-fail", warn: "text-flaky" };
const CELL_CLS: Record<string, string> = { pass: "bg-pass", fail: "bg-fail", flaky: "bg-flaky" };

function Tile({ n, k, cls }: { n: string | number; k: string; cls?: string }) {
  return (
    <div className="bg-bg2 border border-line rounded-[9px] px-[9px] py-[7px]">
      <div className={"text-base font-bold tabular-nums " + (cls ? TILE_CLS[cls] || "" : "")}>{n}</div>
      <div className="text-faint text-[10px] mt-px">{k}</div>
    </div>
  );
}

function Row({ r }: { r: SpecRow }) {
  return (
    <div className="group flex items-center gap-[7px] px-[7px] h-[30px] rounded-md hover:bg-bg2">
      <span className="flex-none text-muted inline-flex">{r.security ? <Shield /> : <Beaker />}</span>
      {r.path ? (
        <span className="flex-1 min-w-0 truncate cursor-pointer hover:text-fg hover:underline" title={r.name} onClick={() => post({ type: "open", path: r.path! })}>{r.name}</span>
      ) : (
        <span className="flex-1 min-w-0 truncate cursor-default" title="not on disk">{r.name}</span>
      )}
      <span className="flex-none flex gap-0.5">
        {r.cells.map((c, i) => (<span key={i} className={"w-[11px] h-[11px] rounded-sm flex-none " + (c ? CELL_CLS[c] : "bg-line")} />))}
      </span>
      {r.path && (
        <span className="flex-none hidden gap-px group-hover:flex">
          <button className="inline-flex items-center justify-center w-6 h-6 text-muted cursor-pointer rounded-[5px] hover:text-fg hover:bg-line" title="Run" onClick={() => post({ type: "runSpec", path: r.path! })}><Play /></button>
          <button className="inline-flex items-center justify-center w-6 h-6 text-muted cursor-pointer rounded-[5px] hover:text-fg hover:bg-line" title="Optimize" onClick={() => post({ type: "optimize", path: r.path! })}><Sparkle /></button>
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
  const groups: Record<string, SpecRow[]> = {};
  const order: string[] = [];
  rows.forEach((r) => { if (!(r.group in groups)) { groups[r.group] = []; order.push(r.group); } groups[r.group].push(r); });
  order.sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));

  return (
    <div className="p-[10px] text-[12px] text-fg">
      <button className="w-full p-2 mb-2 rounded-lg bg-accent text-[#0c2417] text-[12.5px] font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 hover:brightness-110" onClick={() => post({ type: "runAll" })}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z" /></svg> Run all specs
      </button>
      <div className="relative mb-2.5">
        <svg className="absolute left-[9px] top-1/2 -translate-y-1/2 text-faint" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" /></svg>
        <input className="w-full pl-7 pr-[9px] py-[7px] rounded-lg border border-line bg-bg3 text-fg text-[12px] placeholder:text-faint focus:outline-none focus:border-focus" type="text" placeholder="Search specs…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!data ? (
        <div className="text-faint text-center py-[18px] px-1.5 leading-normal">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <Tile n={t!.specs} k="specs" />
            <Tile n={rate} k="last pass rate" cls={rateCls} />
            <Tile n={t!.flaky} k="flaky" cls={t!.flaky ? "warn" : ""} />
            <Tile n={fmtTok(t!.tokens7d)} k="tokens · 7d" />
          </div>
          {rows.length === 0 ? (
            <div className="text-faint text-center py-[18px] px-1.5 leading-normal" dangerouslySetInnerHTML={{ __html: data.rows.length ? "No specs match." : "No specs yet.<br/>Drive your app with Hover to crystallize one." }} />
          ) : (
            <>
              <h3 className="text-[10px] uppercase tracking-wider text-faint mt-3 mb-1.5 mx-0.5 font-semibold">Specs</h3>
              {order.map((g) => (
                <div key={g || "__top"}>
                  {g && <div className="text-muted text-[10.5px] mt-[9px] mb-[3px] mx-1 flex items-center gap-1.5"><Folder />{g}</div>}
                  {groups[g].map((r) => (<Row key={(r.path || "") + r.name} r={r} />))}
                </div>
              ))}
              <div className="flex gap-[11px] text-faint text-[10px] mt-2.5 flex-wrap">
                <span className="inline-flex items-center gap-1"><i className="w-[9px] h-[9px] rounded-sm inline-block bg-pass" />pass</span>
                <span className="inline-flex items-center gap-1"><i className="w-[9px] h-[9px] rounded-sm inline-block bg-fail" />fail</span>
                <span className="inline-flex items-center gap-1"><i className="w-[9px] h-[9px] rounded-sm inline-block bg-flaky" />flaky</span>
                <span className="inline-flex items-center gap-1"><i className="w-[9px] h-[9px] rounded-sm inline-block bg-line" />not run</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
