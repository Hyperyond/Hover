import { useEffect, useState } from "react";
import { post } from "./vscode";
import type { SessionInfo } from "./App";

const LOCK =
  '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>';
const SEARCH =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5" stroke-linecap="round"/></svg>';

/** Top bar: new-session, the conversation switcher (Conversations header +
 *  Local/Cloud tabs + search + rows, mirroring the sidebar), and the app pill. */
export function Header({
  sessionLabel,
  appOnline,
  appLabel,
  sessions,
  activeSess,
}: {
  sessionLabel: string;
  appOnline: boolean;
  appLabel: string;
  sessions: SessionInfo[];
  activeSess: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"local" | "cloud">("local");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("#session, #session-menu")) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  function pick(id: string) {
    setOpen(false);
    if (id === "__new__") post({ type: "command", id: "hover.newSession" });
    else if (id !== activeSess) post({ type: "switchSession", id });
  }

  const ql = q.trim().toLowerCase();
  const rows = sessions.filter((s) => !ql || (s.name || "").toLowerCase().includes(ql));

  return (
    <header>
      <button className="iconbtn" title="New session" onClick={() => post({ type: "command", id: "hover.newSession" })}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
      <button className="barebtn" id="session" title="Conversations" onClick={() => setOpen((o) => !o)}>
        <span id="session-label">{sessionLabel}</span>
      </button>
      {open && (
        <div className="popup sess" id="session-menu">
          <div className="p-hdr">Conversations</div>
          <div className="sess-tabs">
            <div className={"sess-tab" + (tab === "local" ? " active" : "")} onClick={() => setTab("local")}>
              Local
            </div>
            <div
              className={"sess-tab locked" + (tab === "cloud" ? " active" : "")}
              onClick={() => setTab("cloud")}
              title="Cloud conversations — coming soon"
            >
              <span dangerouslySetInnerHTML={{ __html: LOCK }} />
              <span>Cloud</span>
            </div>
          </div>
          {tab === "local" && (
            <div className="sess-search">
              <span dangerouslySetInnerHTML={{ __html: SEARCH }} />
              <input type="text" placeholder="Search sessions…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="sess-list">
            {tab === "cloud" ? (
              <div className="sess-cloud">☁ Cloud sessions are coming soon.</div>
            ) : rows.length === 0 ? (
              <div className="sess-cloud">{sessions.length ? "No conversations match." : "No conversations yet."}</div>
            ) : (
              rows.map((s) => (
                <div className={"p-item" + (s.id === activeSess ? " active" : "")} key={s.id} onClick={() => pick(s.id)}>
                  <div className="p-body">
                    <div className="p-title">{s.name}</div>
                  </div>
                  {s.running ? <span className="p-run" /> : <span className="p-check">✓</span>}
                </div>
              ))
            )}
            {tab === "local" && (
              <div className="p-item" onClick={() => pick("__new__")}>
                <div className="p-body">
                  <div className="p-title">＋ New session</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <span className="spacer" />
      <button className="appstatus" title="App URL — click to set / start" onClick={() => post({ type: "command", id: "hover.appStatus" })}>
        <span className={appOnline ? "dot" : "dot offline"} />
        <span>{appLabel ? (appOnline ? appLabel : `${appLabel} (offline)`) : "detecting…"}</span>
      </button>
    </header>
  );
}
