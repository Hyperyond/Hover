import { useEffect, useRef, useState } from "react";
import { post, onMessage } from "../../shared/vscode";
import "./conversations.css";

/**
 * Conversations view — React port of conversationsView. The extension owns the
 * session store and pushes `{type:'data', rows, activeId}`; this is a thin
 * presenter posting switch / new / rename / delete intents.
 */

interface ConversationRow {
  id: string;
  name: string;
  lastRunAt?: number;
  running?: boolean;
}

function fmtAgo(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

const EditIcon = () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.5 13.5 5 6 12.5l-3 .5.5-3z" /></svg>);
const DelIcon = () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" /></svg>);
const LockIcon = ({ size = 12 }: { size?: number }) => (<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>);

export function Conversations() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState("");
  const [tab, setTab] = useState<"local" | "cloud">("local");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = onMessage((m) => {
      if (m.type !== "data") return;
      const list = Array.isArray(m.rows) ? (m.rows as ConversationRow[]) : [];
      setRows(list);
      setActiveId((m.activeId as string) || "");
      setEditing((e) => (e && !list.some((r) => r.id === e) ? null : e));
    });
    post({ type: "ready" });
    return off;
  }, []);

  useEffect(() => { if (editing) { editRef.current?.focus(); editRef.current?.select(); } }, [editing]);

  const commitEdit = (id: string, value: string) => {
    const v = value.trim();
    const cur = rows.find((r) => r.id === id);
    if (v && cur && v !== cur.name) post({ type: "rename", id, name: v });
    setEditing(null);
  };

  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => !ql || (r.name || "").toLowerCase().includes(ql));

  return (
    <div className="conversations">
      <button className="newbtn" onClick={() => post({ type: "new" })}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3.3v9.4M3.3 8h9.4" /></svg>
        <span>New session</span>
      </button>
      <div className="tabs">
        <div className={"tab" + (tab === "local" ? " active" : "")} onClick={() => setTab("local")}>Local</div>
        <div className={"tab locked" + (tab === "cloud" ? " active" : "")} title="Cloud conversations — coming soon" onClick={() => setTab("cloud")}>
          <LockIcon /><span>Cloud</span>
        </div>
      </div>

      {tab === "cloud" ? (
        <div className="cloud">
          <LockIcon size={26} />
          Cloud sessions are coming soon.<br />Run, monitor &amp; share conversations across machines once Hover Cloud unlocks.
        </div>
      ) : (
        <>
          <div className="search">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" /></svg>
            <input type="text" placeholder="Search sessions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="list">
            {shown.length === 0 ? (
              <div className="empty" dangerouslySetInnerHTML={{ __html: rows.length ? "No conversations match." : "No conversations yet.<br/>Start one with New session." }} />
            ) : (
              shown.map((r) => (
                <div key={r.id} className={"row" + (r.id === activeId ? " active" : "") + (r.running ? " running" : "")}
                  onClick={() => { if (editing !== r.id && r.id !== activeId) post({ type: "switch", id: r.id }); }}>
                  <span className="dot" />
                  {editing === r.id ? (
                    <input ref={editRef} className="nm-edit" defaultValue={r.name}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitEdit(r.id, (e.target as HTMLInputElement).value); }
                        else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                      }}
                      onBlur={(e) => commitEdit(r.id, e.target.value)} />
                  ) : (
                    <>
                      <span className="nm" title={r.name}>{r.name}</span>
                      <span className="ago">{fmtAgo(r.lastRunAt)}</span>
                      <span className="acts">
                        <button className="iact" title="Rename" onClick={(e) => { e.stopPropagation(); setEditing(r.id); }}><EditIcon /></button>
                        <button className="iact" title="Delete" onClick={(e) => { e.stopPropagation(); post({ type: "delete", id: r.id }); }}><DelIcon /></button>
                      </span>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
