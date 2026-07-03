import { useEffect, useState, type ReactNode } from "react";
import { post, onMessage } from "../../shared/vscode";
import { DashboardTab, type DashboardData, type Source } from "../dashboard/Dashboard";

/**
 * The single Hover panel. A mini Hover Cloud in the editor: signed OUT it shows
 * only a sign-in screen; signed IN it's a tabbed shell (Overview / Heal /
 * Environments / Map) fed one combined payload from src/homeView.ts. This owns
 * the message channel; each tab is presentational and posts actions back.
 */

type CloudState = { connected: true; url: string } | { connected: false };
interface EnvAccountVM { label: string; email?: string; hasPassword: boolean }
interface EnvVM { id: string; name: string; url: string; verified?: boolean; isLocal: boolean; active: boolean; accounts: EnvAccountVM[] }
interface HealVM { id: string; specFile: string; slug: string; status: string; branch: string | null; environment: string | null; ciUrl: string | null }
interface MapSummary { exists: boolean; app?: string; stats?: { lines: number; covered: number; areas: number } }
interface Payload {
  cloud: CloudState;
  source?: Source;
  remoteAvailable?: boolean;
  dashboard?: DashboardData;
  environments?: EnvVM[];
  map?: MapSummary;
  heal?: HealVM[];
}

const Cloud = ({ cls = "" }: { cls?: string }) => (<svg className={cls} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4.5 12a2.8 2.8 0 0 1-.3-5.6A3.5 3.5 0 0 1 11 5.6a2.6 2.6 0 0 1 .4 6.4z" strokeLinejoin="round" /></svg>);
const Reticle = () => (<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8.5V4h4.5" /><path d="M19.5 8.5V4H15" /><path d="M4 15.5V20h4.5" /><path d="M19.5 15.5V20H15" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /></svg>);

// ── Sign-in gate ────────────────────────────────────────────────────────────
function SignIn() {
  return (
    <div className="p-4 text-[12px] text-fg flex flex-col items-center text-center gap-3 mt-8">
      <span className="text-accent"><Reticle /></span>
      <div>
        <div className="text-[14px] font-semibold">Hover Cloud</div>
        <div className="text-faint text-[11.5px] mt-1 leading-normal">Sign in to see your CI runs, trends,<br />and the heal queue in this panel.</div>
      </div>
      <button className="w-full max-w-[240px] p-2 mt-1 rounded-lg bg-accent text-[#0c2417] text-[12.5px] font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 hover:brightness-110" onClick={() => post({ type: "connectCloud" })}>
        <Cloud /> Sign in to Hover Cloud
      </button>
      <div className="mt-3 pt-3 border-t border-line w-full max-w-[240px] flex flex-col gap-1.5">
        <button className="text-muted text-[11px] cursor-pointer hover:text-fg inline-flex items-center justify-center gap-1.5" onClick={() => post({ type: "installMcp" })}>
          Install Hover MCP
        </button>
        <button className="text-faint text-[10.5px] cursor-pointer hover:text-fg" onClick={() => post({ type: "openSite" })}>gethover.dev ↗</button>
      </div>
    </div>
  );
}

// ── Heal tab ─────────────────────────────────────────────────────────────────
function Chip({ children }: { children: ReactNode }) {
  return <span className="text-[9.5px] text-muted bg-bg3 border border-line rounded px-1 py-px">{children}</span>;
}
function HealTab({ heal }: { heal: HealVM[] }) {
  if (!heal.length) return <div className="text-faint text-center py-[22px] px-2 text-[11.5px] leading-normal">No open heal requests.<br />When a spec drifts in CI, it shows up here to fix locally.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-faint text-[10.5px] leading-normal mb-0.5">Specs that drifted in CI. Copy the command, paste into your agent, review the diff — CI closes it when green again.</div>
      {heal.map((h) => (
        <div key={h.id} className="rounded-lg border border-line bg-bg2 px-2.5 py-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="flex-1 min-w-0 truncate text-[12px] font-medium" title={h.specFile}>{h.slug}</span>
            {h.ciUrl && <button className="flex-none text-faint text-[10px] hover:text-fg cursor-pointer" title="Open the CI run" onClick={() => post({ type: "openUrl", url: h.ciUrl! })}>CI ↗</button>}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {h.environment && <Chip>{h.environment}</Chip>}
            {h.branch && <Chip>{h.branch}</Chip>}
          </div>
          <button className="w-full mt-0.5 p-1.5 rounded-md border border-accent/60 bg-accent/10 text-fg text-[11.5px] cursor-pointer inline-flex items-center justify-center gap-1.5 hover:bg-accent/20" onClick={() => post({ type: "copyHeal", slug: h.slug })}>
            Copy heal command
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Environments tab ──────────────────────────────────────────────────────────
function EnvTab({ envs }: { envs: EnvVM[] }) {
  const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className="flex flex-col gap-2">
      <button className="w-full p-1.5 rounded-lg border border-line bg-bg2 text-muted text-[11.5px] cursor-pointer inline-flex items-center justify-center gap-1.5 hover:text-fg hover:bg-bg3" onClick={() => post({ type: "envAdd" })}>+ Add environment</button>
      {envs.map((e) => (
        <div key={e.id} className="rounded-lg border border-line bg-bg2 px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <button className="flex-none cursor-pointer" title={e.active ? "Active run target" : "Set active"} onClick={() => !e.active && post({ type: "envSetActive", envId: e.id })}>
              <span className={"inline-block w-3 h-3 rounded-full border " + (e.active ? "bg-accent border-accent" : "border-line")} />
            </button>
            <span className="flex-1 min-w-0 truncate text-[12px] font-medium">{e.name}</span>
            {!e.isLocal && <span className="flex-none text-[10px]" title={e.verified ? "Domain verified" : "Domain not verified (arrives with Hover Cloud)"}>{e.verified ? "✓" : "⚠"}</span>}
          </div>
          <div className="text-faint text-[10.5px] mt-0.5 truncate">{host(e.url)}</div>
          <div className="flex gap-2 mt-1.5 text-[10.5px] text-muted">
            {!e.isLocal && <button className="cursor-pointer hover:text-fg" onClick={() => post({ type: "envEditUrl", envId: e.id })}>edit</button>}
            <button className="cursor-pointer hover:text-fg" onClick={() => post({ type: "envExport", envId: e.id })}>export env</button>
            <button className="cursor-pointer hover:text-fg" onClick={() => post({ type: "envAddAccount", envId: e.id })}>+ account</button>
            {!e.isLocal && <button className="cursor-pointer hover:text-fail ml-auto" onClick={() => post({ type: "envRemove", envId: e.id })}>remove</button>}
          </div>
          {e.accounts.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-line flex flex-col gap-1">
              {e.accounts.map((a) => (
                <div key={a.label} className="group flex items-center gap-1.5 text-[11px]">
                  <span className="flex-none text-muted">👤</span>
                  <span className="flex-1 min-w-0 truncate" title={a.email}>{a.label}{a.email ? <span className="text-faint"> · {a.email}</span> : null}</span>
                  <span className="flex-none text-[9.5px]" title={a.hasPassword ? "Password in SecretStorage" : "No password"}>{a.hasPassword ? "🔑" : "⚠"}</span>
                  <span className="flex-none hidden group-hover:flex gap-1.5 text-[10px] text-muted">
                    <button className="cursor-pointer hover:text-fg" onClick={() => post({ type: "envSetPassword", envId: e.id, label: a.label })}>pw</button>
                    <button className="cursor-pointer hover:text-fail" onClick={() => post({ type: "envRemoveAccount", envId: e.id, label: a.label })}>✕</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Map tab ────────────────────────────────────────────────────────────────────
function MapTab({ map }: { map: MapSummary }) {
  if (!map.exists) {
    return (
      <div className="text-center py-[18px] px-2">
        <div className="text-faint text-[11.5px] leading-normal mb-2.5">No business map yet. Map your app to see flows + coverage.</div>
        <button className="w-full p-1.5 rounded-lg border border-line bg-bg2 text-muted text-[11.5px] cursor-pointer hover:text-fg hover:bg-bg3" onClick={() => post({ type: "copyTestApp" })}>Copy /mcp__hover__test_app</button>
      </div>
    );
  }
  const s = map.stats ?? { lines: 0, covered: 0, areas: 0 };
  const pct = s.lines ? Math.round((s.covered / s.lines) * 100) : 0;
  return (
    <div className="flex flex-col gap-2.5">
      {map.app && <div className="text-[12px] font-medium truncate">{map.app}</div>}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-bg2 border border-line rounded-[9px] px-2 py-[7px]"><div className="text-base font-bold tabular-nums">{s.areas}</div><div className="text-faint text-[10px]">areas</div></div>
        <div className="bg-bg2 border border-line rounded-[9px] px-2 py-[7px]"><div className="text-base font-bold tabular-nums">{s.lines}</div><div className="text-faint text-[10px]">flows</div></div>
        <div className="bg-bg2 border border-line rounded-[9px] px-2 py-[7px]"><div className={"text-base font-bold tabular-nums " + (pct >= 80 ? "text-pass" : pct >= 40 ? "text-flaky" : "")}>{pct}%</div><div className="text-faint text-[10px]">covered</div></div>
      </div>
      <button className="w-full p-1.5 rounded-lg border border-line bg-bg2 text-muted text-[11.5px] cursor-pointer inline-flex items-center justify-center gap-1.5 hover:text-fg hover:bg-bg3" onClick={() => post({ type: "openMap" })}>Open full map</button>
    </div>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────
type TabId = "overview" | "heal" | "env" | "map";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "heal", label: "Heal" },
  { id: "env", label: "Env" },
  { id: "map", label: "Map" },
];

export function Home() {
  const [p, setP] = useState<Payload | null>(null);
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    const off = onMessage((m) => { if (m.type === "data") setP(m as unknown as Payload); });
    post({ type: "ready" });
    return off;
  }, []);

  if (!p) return <div className="p-4 text-faint text-center text-[12px]">Loading…</div>;
  if (!p.cloud.connected) return <SignIn />;

  const host = p.cloud.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const healCount = p.heal?.length ?? 0;

  return (
    <div className="p-[10px] text-[12px] text-fg">
      {/* Cloud status bar */}
      <div className="w-full mb-2 rounded-lg border border-line bg-bg2 px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]">
        <span className="text-accent inline-flex"><Cloud /></span>
        <span className="text-muted flex-1 min-w-0 truncate" title={"Connected to " + host}><span className="text-fg font-medium">Hover Cloud</span> · {host}</span>
        <button className="flex-none text-muted hover:text-fg cursor-pointer" title="Open your Cloud dashboard" onClick={() => post({ type: "openCloud" })}>open ↗</button>
        <button className="flex-none text-faint hover:text-fg cursor-pointer" title="Sign out" onClick={() => post({ type: "disconnectCloud" })}>sign out</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 p-0.5 mb-2.5 rounded-lg border border-line bg-bg2">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={"flex-1 px-1.5 py-1 text-[11px] rounded-md cursor-pointer transition-colors inline-flex items-center justify-center gap-1 " + (tab === t.id ? "bg-bg text-fg font-medium shadow-sm" : "text-muted hover:text-fg")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "heal" && healCount > 0 && <span className="text-[9px] leading-none px-1 py-0.5 rounded-full bg-fail text-white font-semibold">{healCount}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && p.dashboard && <DashboardTab data={p.dashboard} source={p.source ?? "local"} remoteAvailable={!!p.remoteAvailable} />}
      {tab === "heal" && <HealTab heal={p.heal ?? []} />}
      {tab === "env" && <EnvTab envs={p.environments ?? []} />}
      {tab === "map" && <MapTab map={p.map ?? { exists: false }} />}

      {/* Shared footer */}
      <div className="mt-4 pt-2.5 border-t border-line flex flex-col gap-1.5">
        <button className="w-full p-1.5 rounded-lg border border-line bg-bg2 text-muted text-[11.5px] cursor-pointer inline-flex items-center justify-center gap-1.5 hover:text-fg hover:bg-bg3" title="Add the Hover MCP server to your coding agent" onClick={() => post({ type: "installMcp" })}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 1.5v6M5.5 5 8 7.5 10.5 5M3 9.5v3.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Install Hover MCP
        </button>
        <button className="text-faint text-[10.5px] cursor-pointer hover:text-fg inline-flex items-center justify-center gap-1" onClick={() => post({ type: "openSite" })}>gethover.dev <span className="opacity-70">↗</span></button>
      </div>
    </div>
  );
}
