import { useEffect, useState } from "react";
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
interface CloudEnv { name: string; url: string }
interface CloudAccount { label: string; environment: string }
interface Payload {
  cloud: CloudState;
  repo?: string | null;
  source?: Source;
  remoteAvailable?: boolean;
  dashboard?: DashboardData;
  environments?: EnvVM[];
  map?: MapSummary;
  heal?: HealVM[];
  env?: string | null;
  remoteEnvironments?: string[];
  cloudEnvironments?: CloudEnv[];
  cloudAccounts?: CloudAccount[];
  envFileExists?: boolean;
  needsEnvSetup?: boolean;
}

const Cloud = ({ cls = "" }: { cls?: string }) => (<svg className={cls} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4.5 12a2.8 2.8 0 0 1-.3-5.6A3.5 3.5 0 0 1 11 5.6a2.6 2.6 0 0 1 .4 6.4z" strokeLinejoin="round" /></svg>);
// ── Signed-out banner ────────────────────────────────────────────────────────
// Local-first: the panel works without signing in (Overview·Local / Env / Map).
// This compact banner invites sign-in, which unlocks Remote + the Heal queue.
function SignInBanner() {
  return (
    <div className="w-full mb-2.5 rounded-lg border border-accent/50 bg-accent/10 px-2.5 py-2 flex items-center gap-2">
      <span className="text-accent flex-none"><Cloud /></span>
      <span className="flex-1 min-w-0 text-[11px] text-muted leading-snug">Sign in to unlock Cloud CI runs &amp; the heal queue.</span>
      <button className="flex-none px-2 py-1 rounded-md bg-accent text-[#0c2417] text-[11px] font-semibold cursor-pointer hover:brightness-110" onClick={() => post({ type: "connectCloud" })}>Sign in</button>
    </div>
  );
}

// ── Setup flow (locked until an environment is chosen) ───────────────────────
// The active environment drives everything (run target + the MCP's test/heal
// URL & account), so we make choosing it a required first step rather than a
// silent default. Local-first: "Use Local" is a valid completion.
function SetupChoice({ title, sub, onClick, primary }: { title: string; sub: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      className={"w-full text-left rounded-lg border px-3 py-2.5 cursor-pointer transition-colors " + (primary ? "border-accent/60 bg-accent/10 hover:bg-accent/20" : "border-line bg-bg2 hover:bg-bg3")}
      onClick={onClick}
    >
      <div className="text-[12.5px] font-medium text-fg">{title}</div>
      <div className="text-[10.5px] text-faint mt-0.5 leading-snug">{sub}</div>
    </button>
  );
}
function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-1">
      {[1, 2].map((n) => (
        <span key={n} className={"h-1.5 rounded-full transition-all " + (n === step ? "w-4 bg-accent" : "w-1.5 bg-line")} />
      ))}
    </div>
  );
}
function SetupScreen({ p }: { p: Payload }) {
  const connected = p.cloud.connected;
  const cloudEnvs = p.cloudEnvironments ?? [];
  // Two-step flow: 1) optional sign-in, 2) choose environment. Signing in flips
  // `connected` on the next payload → auto-advance to step 2.
  const [step, setStep] = useState<1 | 2>(connected ? 2 : 1);
  useEffect(() => { if (connected) setStep(2); }, [connected]);

  return (
    <div className="p-4 text-[12px] text-fg flex flex-col gap-3">
      <StepDots step={step} />
      {step === 1 ? (
        <>
          <div className="flex flex-col items-center text-center gap-1.5">
            <span className="text-accent"><Cloud /></span>
            <div className="text-[14px] font-semibold">Sign in to Hover Cloud</div>
            <div className="text-faint text-[11px] leading-normal">Optional. Unlocks CI run history, the heal queue, and importing your staging / prod environments. Hover works locally without it.</div>
          </div>
          <div className="flex flex-col gap-2 mt-1">
            <SetupChoice primary title="Sign in to Hover Cloud" sub="Approve in the browser — no token to paste." onClick={() => post({ type: "connectCloud" })} />
            <SetupChoice title="Skip — use Hover locally" sub="Continue without an account. You can sign in later." onClick={() => setStep(2)} />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center text-center gap-1.5">
            <span className="text-accent"><EnvIcon /></span>
            <div className="text-[14px] font-semibold">Set your test environment</div>
            <div className="text-faint text-[11px] leading-normal">Hover runs &amp; heals against this — pick where your app lives. Change it anytime.</div>
          </div>
          <div className="flex flex-col gap-2 mt-1">
            <SetupChoice primary title="Use Local (localhost)" sub="Test the dev server on your machine." onClick={() => post({ type: "useLocalEnv" })} />
            <SetupChoice title="Add an environment" sub="A deployed URL — staging, prod, a preview." onClick={() => post({ type: "envAdd" })} />
            {connected && cloudEnvs.length > 0 && (
              <SetupChoice title={`Import ${cloudEnvs.length} from Hover Cloud`} sub={cloudEnvs.map((e) => e.name).join(", ")} onClick={() => post({ type: "importCloudEnvs" })} />
            )}
          </div>
          {!connected && (
            <button className="text-faint text-[10.5px] hover:text-fg cursor-pointer mt-0.5" onClick={() => setStep(1)}>← Back to sign-in</button>
          )}
        </>
      )}
    </div>
  );
}

// ── Heal tab ─────────────────────────────────────────────────────────────────
const BranchIcon = () => (<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="4" cy="3.5" r="1.6" /><circle cx="4" cy="12.5" r="1.6" /><circle cx="12" cy="5" r="1.6" /><path d="M4 5v6M12 6.6c0 2.4-2 2.9-4 3.4" strokeLinecap="round" /></svg>);
const EnvIcon = () => (<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.8 2 1.8 9 0 11M8 2.5c-1.8 2-1.8 9 0 11" /></svg>);

/** A labelled metadata chip. Env chips are accent-tinted, branch chips neutral,
 *  each with an icon + explicit tooltip so the two never blur together. */
function MetaChip({ kind, value }: { kind: "env" | "branch"; value: string }) {
  const isEnv = kind === "env";
  return (
    <span
      className={"inline-flex items-center gap-1 text-[9.5px] rounded px-1 py-px border " + (isEnv ? "text-accent border-accent/40 bg-accent/10" : "text-muted border-line bg-bg3")}
      title={isEnv ? `Environment the CI run targeted: ${value}` : `Git branch: ${value}`}
    >
      {isEnv ? <EnvIcon /> : <BranchIcon />}
      {value}
    </span>
  );
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
            {h.environment && <MetaChip kind="env" value={h.environment} />}
            {h.branch && <MetaChip kind="branch" value={h.branch} />}
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
const hostOf = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Read-only mirror of the environments Hover Cloud manages for this project
 *  (URLs from the project's CI config / GitHub Environments). Editing happens in
 *  Cloud; the local roster below is for local dev + credentials. */
function CloudEnvGroup({ cloudEnvs, cloudAccounts }: { cloudEnvs: CloudEnv[]; cloudAccounts: CloudAccount[] }) {
  if (!cloudEnvs.length) return null;
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-accent font-semibold mb-1.5">
        <Cloud /> Cloud environments
      </div>
      {cloudEnvs.map((e) => {
        const accts = cloudAccounts.filter((a) => a.environment === e.name);
        return (
          <div key={e.name} className="py-1 border-t border-line first:border-t-0">
            <div className="text-[12px] font-medium">{e.name}</div>
            <div className="text-faint text-[10.5px] truncate">{hostOf(e.url)}</div>
            {accts.length > 0 && (
              <div className="text-muted text-[10px] mt-0.5">accounts: {accts.map((a) => a.label).join(", ")}</div>
            )}
          </div>
        );
      })}
      <div className="text-faint text-[9.5px] mt-1.5 leading-snug">Managed in Hover Cloud. Set passwords locally below for MCP test/heal.</div>
    </div>
  );
}

/** Guidance for the D-flow: the active environment is what the MCP (your agent)
 *  targets for test/heal — its URL rides in .hover/active.json; this exports its
 *  credentials to .hover/.env so the agent can log in. One button to wire it up. */
function McpTargetCard({ active, envFileExists }: { active?: EnvVM; envFileExists: boolean }) {
  const hasAccounts = !!active?.accounts.length;
  return (
    <div className="rounded-lg border border-line bg-bg2 px-2.5 py-2 text-[11px]">
      <div className="text-[10px] uppercase tracking-wider text-faint font-semibold mb-1">Agent (MCP) target</div>
      <div className="text-muted leading-snug">
        Your agent tests &amp; heals against{" "}
        <span className="text-fg font-medium">{active?.name ?? "Local"}</span>
        {active ? <span className="text-faint"> · {hostOf(active.url)}</span> : null}
      </div>
      <div className="mt-1 text-[10.5px]">
        <span className={envFileExists ? "text-pass" : "text-flaky"}>
          {envFileExists ? "✓ credentials exported for login" : "⚠ credentials not exported"}
        </span>
      </div>
      {hasAccounts ? (
        <button
          className="w-full mt-1.5 p-1.5 rounded-md border border-accent/60 bg-accent/10 text-fg cursor-pointer hover:bg-accent/20"
          title="Write this environment's HOVER_<LABEL>_USER/PASS to .hover/.env so the MCP can log in during test/heal"
          onClick={() => post({ type: "envSyncMcp" })}
        >
          {envFileExists ? "Re-export credentials for MCP" : "Export credentials for MCP"}
        </button>
      ) : (
        <div className="text-faint mt-1 text-[10px] leading-snug">Add an account with a password below so the agent can log in.</div>
      )}
    </div>
  );
}

function EnvTab({ envs, cloudEnvs, cloudAccounts, envFileExists }: { envs: EnvVM[]; cloudEnvs: CloudEnv[]; cloudAccounts: CloudAccount[]; envFileExists: boolean }) {
  const host = hostOf;
  const active = envs.find((e) => e.active);
  return (
    <div className="flex flex-col gap-2">
      <McpTargetCard active={active} envFileExists={envFileExists} />
      <CloudEnvGroup cloudEnvs={cloudEnvs} cloudAccounts={cloudAccounts} />
      {cloudEnvs.length > 0 && <div className="text-[10px] uppercase tracking-wider text-faint font-semibold px-1">Local</div>}
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
  // Locked first-run flow: choose an environment before the panel opens.
  if (p.needsEnvSetup) return <SetupScreen p={p} />;

  const connected = p.cloud.connected;
  const cloudUrl = p.cloud.connected ? p.cloud.url : "";
  const host = cloudUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const healCount = p.heal?.length ?? 0;
  // Heal is Cloud-only; hide its tab (and any cloud-only chrome) when signed out.
  const tabs = TABS.filter((t) => t.id !== "heal" || connected);
  const activeTab: TabId = tabs.some((t) => t.id === tab) ? tab : "overview";

  return (
    <div className="p-[10px] text-[12px] text-fg">
      {/* Cloud status — connected bar, or a sign-in invite (local-first) */}
      {connected ? (
        <>
          <div className="w-full mb-2 rounded-lg border border-line bg-bg2 px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]">
            <span className="text-accent inline-flex"><Cloud /></span>
            <span className="text-muted flex-1 min-w-0 truncate" title={"Connected to " + host}><span className="text-fg font-medium">Hover Cloud</span> · {host}</span>
            <button className="flex-none text-muted hover:text-fg cursor-pointer" title="Open your Cloud dashboard" onClick={() => post({ type: "openCloud" })}>open ↗</button>
            <button className="flex-none text-faint hover:text-fg cursor-pointer" title="Sign out" onClick={() => post({ type: "disconnectCloud" })}>sign out</button>
          </div>
          {/* Linked project — scopes Remote + Heal to this repo */}
          {p.repo ? (
            <div className="w-full mb-2.5 px-1 flex items-center gap-1.5 text-[10.5px] text-faint">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4.5h4l1.2 1.5H14v6.5H2z" /></svg>
              <span className="flex-1 min-w-0 truncate" title={"Cloud project: " + p.repo}>{p.repo}</span>
              <button className="flex-none hover:text-fg cursor-pointer" title="Link a different Cloud project" onClick={() => post({ type: "pickRepo" })}>change</button>
            </div>
          ) : (
            <button className="w-full mb-2.5 p-1.5 rounded-lg border border-flaky/50 bg-flaky/10 text-fg text-[11px] cursor-pointer inline-flex items-center justify-center gap-1.5 hover:bg-flaky/20" title="Couldn't match this workspace to a Cloud project from its git remote" onClick={() => post({ type: "pickRepo" })}>
              ⚠ No Cloud project linked — select one
            </button>
          )}
          {/* Environment scope — filters Remote runs + the Heal queue */}
          {(p.remoteEnvironments?.length ?? 0) > 0 && (
            <div className="w-full mb-2.5 px-1 flex items-center gap-1.5 text-[10.5px] text-faint">
              <EnvIcon />
              <span className="flex-none">Environment</span>
              <select
                className="flex-1 min-w-0 bg-bg3 border border-line rounded px-1 py-0.5 text-[10.5px] text-fg cursor-pointer focus:outline-none focus:border-focus"
                value={p.env ?? ""}
                onChange={(e) => post({ type: "setEnv", env: e.target.value })}
              >
                <option value="">All environments</option>
                {p.remoteEnvironments!.map((e) => (<option key={e} value={e}>{e}</option>))}
              </select>
            </div>
          )}
        </>
      ) : (
        <SignInBanner />
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 p-0.5 mb-2.5 rounded-lg border border-line bg-bg2">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={"flex-1 px-1.5 py-1 text-[11px] rounded-md cursor-pointer transition-colors inline-flex items-center justify-center gap-1 " + (activeTab === t.id ? "bg-bg text-fg font-medium shadow-sm" : "text-muted hover:text-fg")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "heal" && healCount > 0 && <span className="text-[9px] leading-none px-1 py-0.5 rounded-full bg-fail text-white font-semibold">{healCount}</span>}
          </button>
        ))}
      </div>

      {activeTab === "overview" && p.dashboard && <DashboardTab data={p.dashboard} source={p.source ?? "local"} remoteAvailable={!!p.remoteAvailable} connected={connected} />}
      {activeTab === "heal" && <HealTab heal={p.heal ?? []} />}
      {activeTab === "env" && <EnvTab envs={p.environments ?? []} cloudEnvs={p.cloudEnvironments ?? []} cloudAccounts={p.cloudAccounts ?? []} envFileExists={!!p.envFileExists} />}
      {activeTab === "map" && <MapTab map={p.map ?? { exists: false }} />}

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
