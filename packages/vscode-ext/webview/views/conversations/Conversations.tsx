import { useEffect, useRef, useState } from "react";
import { post, onMessage } from "../../shared/vscode";

/**
 * Conversations view. The extension owns the session store and pushes
 * `{type:'data', rows, activeId}`; this is a thin presenter posting
 * switch / new / rename / delete. Styled with Tailwind utilities.
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

const EditIcon = () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px]"><path d="M11 2.5 13.5 5 6 12.5l-3 .5.5-3z" /></svg>);
const DelIcon = () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px]"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" /></svg>);
const LockIcon = ({ size = 12 }: { size?: number }) => (<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>);

const ACTIVE_TAB = "text-fg bg-[var(--vscode-editor-background,var(--color-bg2))] shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_0_0_1px_var(--color-line)]";

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
    <div className="pt-2.5 px-2.5 pb-3 text-[12.5px] text-fg">
      <button className="w-full flex items-center gap-2 px-2.5 py-2 mb-2.5 rounded-[9px] border border-line bg-bg2 text-fg cursor-pointer text-[12.5px] font-medium hover:bg-listhover hover:border-focus" onClick={() => post({ type: "new" })}>
        <svg className="flex-none opacity-85" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3.3v9.4M3.3 8h9.4" /></svg>
        <span>New session</span>
      </button>
      <div className="flex gap-0.5 mb-2.5 p-[3px] rounded-[9px] border border-line bg-bg3">
        <div className={"flex-1 inline-flex items-center justify-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer select-none font-medium " + (tab === "local" ? ACTIVE_TAB : "text-muted")} onClick={() => setTab("local")}>Local</div>
        <div className={"flex-1 inline-flex items-center justify-center gap-1.5 px-1 py-1.5 rounded-md cursor-default select-none font-medium " + (tab === "cloud" ? ACTIVE_TAB : "text-muted hover:text-faint")} title="Cloud conversations — coming soon" onClick={() => setTab("cloud")}>
          <LockIcon /><span>Cloud</span>
        </div>
      </div>

      {tab === "cloud" ? (
        <div className="text-faint text-center py-[26px] px-2.5 leading-relaxed">
          <span className="block mx-auto mb-2 opacity-50 w-fit"><LockIcon size={26} /></span>
          Cloud sessions are coming soon.<br />Run, monitor &amp; share conversations across machines once Hover Cloud unlocks.
        </div>
      ) : (
        <>
          <div className="relative mb-2">
            <svg className="absolute left-[9px] top-1/2 -translate-y-1/2 text-faint pointer-events-none" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" /></svg>
            <input className="w-full pl-7 pr-[9px] py-[7px] rounded-lg border border-line bg-bg3 text-fg text-[12.5px] placeholder:text-faint focus:outline-none focus:border-focus" type="text" placeholder="Search sessions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-col gap-px">
            {shown.length === 0 ? (
              <div className="text-faint text-center py-[26px] px-2.5 leading-relaxed" dangerouslySetInnerHTML={{ __html: rows.length ? "No conversations match." : "No conversations yet.<br/>Start one with New session." }} />
            ) : (
              shown.map((r) => {
                const active = r.id === activeId;
                return (
                  <div key={r.id} className={"group flex items-center gap-2 px-[9px] h-9 rounded-lg cursor-pointer hover:bg-bg2 " + (active ? "bg-bg2" : "")}
                    onClick={() => { if (editing !== r.id && !active) post({ type: "switch", id: r.id }); }}>
                    {r.running && <span className="flex-none w-1.5 h-1.5 rounded-full bg-run animate-dot" />}
                    {editing === r.id ? (
                      <input ref={editRef} className="flex-1 min-w-0 px-1.5 py-[3px] rounded-md border border-accent bg-bg3 text-fg text-[12.5px] focus:outline-none" defaultValue={r.name}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitEdit(r.id, (e.target as HTMLInputElement).value); }
                          else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                        }}
                        onBlur={(e) => commitEdit(r.id, e.target.value)} />
                    ) : (
                      <>
                        <span className={"flex-1 min-w-0 truncate group-hover:text-fg " + (active ? "text-fg font-semibold" : "text-muted")} title={r.name}>{r.name}</span>
                        <span className="flex-none text-faint text-[11.5px] tabular-nums">{fmtAgo(r.lastRunAt)}</span>
                        <span className="flex-none hidden group-hover:flex gap-px ml-0.5">
                          <button className="inline-flex items-center justify-center w-[26px] h-[26px] text-muted cursor-pointer rounded-md hover:text-fg hover:bg-listhover" title="Rename" onClick={(e) => { e.stopPropagation(); setEditing(r.id); }}><EditIcon /></button>
                          <button className="inline-flex items-center justify-center w-[26px] h-[26px] text-muted cursor-pointer rounded-md hover:text-fg hover:bg-listhover" title="Delete" onClick={(e) => { e.stopPropagation(); post({ type: "delete", id: r.id }); }}><DelIcon /></button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
