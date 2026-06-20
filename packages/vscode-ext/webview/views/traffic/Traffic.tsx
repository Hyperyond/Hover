import { useEffect, useState } from "react";
import { post, onMessage } from "../../shared/vscode";
import "./traffic.css";

/**
 * Network (Traffic) view — React port of trafficView. The security/pentest MITM
 * proxy captures flows; the extension forwards them via all / flow / clear. This
 * presenter renders a live list (method · URL · status · duration), click to
 * expand request/response detail.
 */

interface FlowReq { method?: string; url?: string; startedAt?: number; headers?: Record<string, string>; body?: string }
interface FlowRes { statusCode?: number; statusMessage?: string; completedAt?: number; headers?: Record<string, string>; body?: string }
interface Flow { id: string; request?: FlowReq; response?: FlowRes; mutated?: boolean }

const esc = (t: unknown) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const statusClass = (c?: number) => (c == null ? "pend" : c < 300 ? "ok" : c < 400 ? "warn" : "err");
const dur = (f: Flow) => {
  const r = f.request, s = f.response;
  if (r && s && r.startedAt && s.completedAt) {
    const ms = s.completedAt - r.startedAt;
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
  return "";
};
const shortUrl = (u?: string) => { try { const x = new URL(u!); return x.pathname + x.search; } catch { return u || ""; } };
const headersText = (h?: Record<string, string>) => (h ? Object.keys(h).map((k) => `${k}: ${h[k]}`).join("\n") : "");

function detailHtml(f: Flow): string {
  const r = f.request || {}, s = f.response || {};
  let out = `<b>${esc((r.method || "").toUpperCase())}</b> ${esc(r.url || "")}\n`;
  if (s.statusCode != null) out += `<b>← ${esc(s.statusCode)}${s.statusMessage ? " " + esc(s.statusMessage) : ""}</b>\n`;
  const rh = headersText(r.headers); if (rh) out += `\n<b>Request headers</b>\n${esc(rh)}\n`;
  if (r.body) out += `\n<b>Request body</b>\n${esc(String(r.body).slice(0, 2000))}\n`;
  const sh = headersText(s.headers); if (sh) out += `\n<b>Response headers</b>\n${esc(sh)}\n`;
  if (s.body) out += `\n<b>Response body</b>\n${esc(String(s.body).slice(0, 2000))}`;
  return out;
}

export function Traffic() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const off = onMessage((m) => {
      if (m.type === "all") setFlows(Array.isArray(m.flows) ? (m.flows as Flow[]) : []);
      else if (m.type === "flow") {
        const flow = m.flow as Flow;
        setFlows((p) => { const i = p.findIndex((f) => f.id === flow.id); if (i >= 0) { const c = [...p]; c[i] = flow; return c; } return [...p, flow]; });
      } else if (m.type === "clear") { setFlows([]); setOpenId(null); }
    });
    post({ type: "ready" });
    return off;
  }, []);

  const ql = q.trim().toLowerCase();
  const shown = flows.filter((f) => { const r = f.request || {}; return !ql || `${r.url || ""} ${r.method || ""}`.toLowerCase().includes(ql); });

  return (
    <div className="traffic">
      <div className="bar">
        <div className="search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" /></svg>
          <input type="text" placeholder="Filter by URL or method…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="count">{shown.length || ""}</span>
      </div>
      {shown.length === 0 ? (
        <div className="empty" dangerouslySetInnerHTML={{ __html: flows.length ? "No requests match." : "No requests captured yet.<br/>Browse your app in security / pentest mode to capture traffic." }} />
      ) : (
        <div className="list">
          {[...shown].reverse().map((f) => {
            const r = f.request || {}, s = f.response || {};
            const m = (r.method || "").toUpperCase();
            return (
              <div key={f.id}>
                <div className={"row" + (f.id === openId ? " open" : "")} onClick={() => setOpenId((o) => (o === f.id ? null : f.id))}>
                  <span className={"m " + m}>{m}</span>
                  <span className="u" title={r.url || ""}>{shortUrl(r.url)}</span>
                  <span className={"s " + statusClass(s.statusCode)}>{s.statusCode == null ? "…" : s.statusCode}</span>
                  <span className="d">{dur(f)}</span>
                </div>
                {f.id === openId && <div className="detail" dangerouslySetInnerHTML={{ __html: detailHtml(f) }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
