import { useEffect, useState } from "react";
import { post, onMessage } from "../../shared/vscode";

/**
 * Network (Traffic) view — the security/pentest MITM proxy captures flows; the
 * extension forwards them via all / flow / clear. This presenter renders a live
 * list (method · URL · status · duration), click to expand request/response
 * detail. Styled with Tailwind utilities (see webview/theme.css).
 */

interface FlowReq { method?: string; url?: string; startedAt?: number; headers?: Record<string, string>; body?: string }
interface FlowRes { statusCode?: number; statusMessage?: string; completedAt?: number; headers?: Record<string, string>; body?: string }
interface Flow { id: string; request?: FlowReq; response?: FlowRes; mutated?: boolean }

const esc = (t: unknown) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const statusClass = (c?: number) => (c == null ? "text-faint" : c < 300 ? "text-ok" : c < 400 ? "text-warn" : "text-err");
const methodClass = (m: string) =>
  m === "GET" ? "text-method-get" : m === "POST" ? "text-ok" : m === "PUT" || m === "PATCH" ? "text-warn" : m === "DELETE" ? "text-err" : "text-muted";
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

// Detail is injected HTML (pre-wrapped). Labels styled inline so no stylesheet
// rule is needed for the dangerouslySetInnerHTML content.
const B = (t: string) => `<b style="color:var(--color-fg);font-weight:600">${t}</b>`;
function detailHtml(f: Flow): string {
  const r = f.request || {}, s = f.response || {};
  let out = `${B(esc((r.method || "").toUpperCase()))} ${esc(r.url || "")}\n`;
  if (s.statusCode != null) out += `${B(`← ${esc(s.statusCode)}${s.statusMessage ? " " + esc(s.statusMessage) : ""}`)}\n`;
  const rh = headersText(r.headers); if (rh) out += `\n${B("Request headers")}\n${esc(rh)}\n`;
  if (r.body) out += `\n${B("Request body")}\n${esc(String(r.body).slice(0, 2000))}\n`;
  const sh = headersText(s.headers); if (sh) out += `\n${B("Response headers")}\n${esc(sh)}\n`;
  if (s.body) out += `\n${B("Response body")}\n${esc(String(s.body).slice(0, 2000))}`;
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
    <div className="p-2 pb-3 text-[12px] text-fg">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" /></svg>
          <input className="w-full pl-[26px] pr-[9px] py-[6px] rounded-[7px] border border-line bg-bg3 text-fg text-[12px] placeholder:text-faint focus:outline-none focus:border-focus"
            type="text" placeholder="Filter by URL or method…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="flex-none text-faint text-[11px] tabular-nums">{shown.length || ""}</span>
      </div>
      {shown.length === 0 ? (
        <div className="text-faint text-center py-[26px] px-[10px] leading-normal" dangerouslySetInnerHTML={{ __html: flows.length ? "No requests match." : "No requests captured yet.<br/>Browse your app in security / pentest mode to capture traffic." }} />
      ) : (
        <div className="flex flex-col">
          {[...shown].reverse().map((f) => {
            const r = f.request || {}, s = f.response || {};
            const m = (r.method || "").toUpperCase();
            const open = f.id === openId;
            return (
              <div key={f.id}>
                <div className={"flex items-center gap-[7px] px-[6px] py-[5px] rounded-md cursor-pointer border-l-2 hover:bg-bg2 " + (open ? "bg-bg2 border-l-muted" : "border-l-transparent")}
                  onClick={() => setOpenId((o) => (o === f.id ? null : f.id))}>
                  <span className={"flex-none w-[46px] font-semibold text-[10.5px] tracking-wide " + methodClass(m)}>{m}</span>
                  <span className="flex-1 min-w-0 truncate text-left [direction:rtl]" title={r.url || ""}>{shortUrl(r.url)}</span>
                  <span className={"flex-none tabular-nums " + statusClass(s.statusCode)}>{s.statusCode == null ? "…" : s.statusCode}</span>
                  <span className="flex-none w-[46px] text-right text-faint text-[10.5px]">{dur(f)}</span>
                </div>
                {open && <div className="px-[10px] py-[7px] mb-1 rounded-md bg-bg3 font-mono text-[11px] whitespace-pre-wrap break-all text-muted" dangerouslySetInnerHTML={{ __html: detailHtml(f) }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
