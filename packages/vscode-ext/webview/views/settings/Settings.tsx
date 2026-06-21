import { useEffect, useRef, useState } from "react";
import { post, onMessage } from "../../shared/vscode";

/**
 * Settings view — two-tab model config (Local CLI / BYOK) + general toggles.
 * Same message protocol as before (ready / change / state). Styled with
 * Tailwind utilities (see webview/theme.css).
 */

interface AgentItem { id: string; label: string; tagline: string; installed: boolean; sandbox?: string; installHint: string; homepage: string }
interface ByokState { protocol: string; gateway: string; baseUrl: string; model: string; maxTokens: number; hasKey: boolean }
interface State {
  modelSource: "cli" | "byok";
  agent: string;
  agents: AgentItem[];
  speech: boolean;
  voiceZh: string;
  voiceEn: string;
  browser: string;
  agentContext: string;
  localBaseUrl: string;
  localModel: string;
  byok: ByokState;
}

const PROTOCOLS = [
  { id: "anthropic", label: "Anthropic", cli: "Claude Code", base: "https://api.anthropic.com", model: "claude-sonnet-4-5", keyPh: "sk-ant-…", sec: "Anthropic API", getkey: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "OpenAI", cli: "Codex CLI", base: "https://api.openai.com/v1", model: "gpt-5.5", keyPh: "sk-…", sec: "OpenAI API", getkey: "https://platform.openai.com/api-keys" },
  { id: "azure", label: "Azure OpenAI", cli: "Codex CLI", base: "https://<resource>.openai.azure.com", model: "<deployment>", keyPh: "<azure key>", sec: "Azure OpenAI", getkey: "https://portal.azure.com" },
  { id: "gemini", label: "Google Gemini", cli: "Gemini CLI", base: "https://generativelanguage.googleapis.com", model: "gemini-2.5-pro", keyPh: "AIza…", sec: "Google Gemini API", getkey: "https://aistudio.google.com/apikey" },
];
const GATEWAYS = [
  { id: "ollama-cloud", label: "Ollama Cloud", base: "https://ollama.com/v1" },
  { id: "sense", label: "SenseAudio", base: "" },
  { id: "aihubmix", label: "AIHubMix", base: "https://aihubmix.com/v1" },
];
const ICO_BG: Record<string, string> = { claude: "#d97757", codex: "#10a37f", gemini: "#4285f4", qwen: "#7CFFA8" };
const proto = (id: string) => PROTOCOLS.find((p) => p.id === id) ?? PROTOCOLS[0];
const DEFAULT_BYOK: ByokState = { protocol: "anthropic", gateway: "none", baseUrl: "", model: "", maxTokens: 0, hasKey: false };

const TXTIN = "w-full px-[9px] py-[7px] rounded-[7px] border border-line bg-bg3 text-fg text-[12px] placeholder:text-faint focus:outline-none focus:border-focus";
const SEC = "text-[11px] tracking-[0.04em] uppercase text-faint mt-1 mb-2";
const FLBL = "text-[12px] text-fg mt-3 mb-[5px] flex items-center justify-between";
const FHINT = "text-faint text-[11px] mt-1";
const ROW = "flex items-center justify-between gap-3 py-2.5 border-b border-line last:border-b-0";

export function Settings() {
  const [s, setS] = useState<State>({
    modelSource: "cli", agent: "claude", agents: [], speech: false, voiceZh: "", voiceEn: "", browser: "silent",
    agentContext: "shared", localBaseUrl: "", localModel: "", byok: DEFAULT_BYOK,
  });
  // System TTS voices (for the narration voice pickers). Populated async — the
  // first getVoices() is often empty until the engine fires voiceschanged.
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => setVoices(synth.getVoices().map((v) => ({ name: v.name, lang: v.lang })));
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, []);
  const [keyText, setKeyText] = useState("");
  const [keyShown, setKeyShown] = useState(false);
  const keyTouched = useRef(false);

  useEffect(() => {
    const off = onMessage((m) => {
      if (m.type !== "state") return;
      const next: State = {
        modelSource: m.modelSource === "byok" ? "byok" : "cli",
        agent: (m.agent as string) || "claude",
        agents: (m.agents as AgentItem[]) || [],
        speech: !!m.speech,
        voiceZh: (m.voiceZh as string) || "",
        voiceEn: (m.voiceEn as string) || "",
        browser: (m.browser as string) || "silent",
        agentContext: (m.agentContext as string) || "shared",
        localBaseUrl: (m.localBaseUrl as string) || "",
        localModel: (m.localModel as string) || "",
        byok: { ...DEFAULT_BYOK, ...(m.byok as Partial<ByokState> | undefined) },
      };
      setS(next);
      keyTouched.current = false;
      setKeyShown(false);
      setKeyText(next.byok.hasKey ? "••••••••••••" : "");
    });
    post({ type: "ready" });
    return off;
  }, []);

  const change = (patch: Record<string, unknown>) => post({ type: "change", ...patch });
  const setByok = (patch: Partial<ByokState>) => setS((p) => ({ ...p, byok: { ...p.byok, ...patch } }));
  const selectTab = (src: "cli" | "byok") => { setS((p) => ({ ...p, modelSource: src })); change({ modelSource: src }); };
  const pickAgent = (id: string) => { setS((p) => ({ ...p, modelSource: "cli", agent: id })); change({ modelSource: "cli", agent: id }); };
  const setProtocol = (id: string) => { setByok({ protocol: id, gateway: "none", baseUrl: "" }); change({ byokProtocol: id, byokGateway: "none", byokBaseUrl: "" }); };
  const toggleGateway = (id: string) => {
    const on = s.byok.gateway === id;
    const g = GATEWAYS.find((x) => x.id === id);
    const gateway = on ? "none" : id;
    const baseUrl = on ? "" : g?.base || "";
    setByok({ gateway, baseUrl });
    change({ byokGateway: gateway, byokBaseUrl: baseUrl });
  };
  const onKeyChange = (v: string) => { if (v.indexOf("•") === 0) return; setByok({ hasKey: !!v.trim() }); change({ byokApiKey: v.trim() }); };

  const installed = s.agents.filter((a) => a.installed);
  const missing = s.agents.filter((a) => !a.installed);
  const p = proto(s.byok.protocol);
  const chip = (on: boolean) => "px-3 py-1.5 rounded-full border text-[12px] cursor-pointer transition-colors " + (on ? "bg-accent text-[#0a0a0a] border-accent font-semibold" : "border-line bg-bg3 text-muted hover:text-fg hover:border-focus");

  return (
    <div className="p-3 text-[13px] text-fg overflow-y-auto">
      <div className={SEC}>Model</div>
      <div className="flex p-[3px] mb-2.5 rounded-[9px] border border-line bg-bg3">
        {(["cli", "byok"] as const).map((src) => (
          <button key={src} className={"flex-1 text-center px-2.5 py-[7px] rounded-md cursor-pointer text-[12.5px] font-medium " + (s.modelSource === src ? "bg-bg2 text-fg shadow-[0_1px_2px_rgba(0,0,0,0.3)]" : "text-muted")} onClick={() => selectTab(src)}>{src === "cli" ? "Local CLI" : "BYOK"}</button>
        ))}
      </div>

      {s.modelSource === "cli" ? (
        <div>
          <div className="text-faint text-[11px] mt-0.5 mb-2.5">The coding-agent CLI that drives runs, using its own logged-in subscription.</div>
          <div className="flex items-center justify-between my-1.5">
            <span className="text-[12px] text-muted">Your CLIs ({installed.length})</span>
            <button className="bg-bg3 text-muted border border-line rounded-md px-[9px] py-1 text-[11.5px] cursor-pointer inline-flex items-center gap-1.5 hover:text-fg hover:border-focus" onClick={() => change({ rescan: true })}>↻ Rescan</button>
          </div>
          {installed.length === 0 && <div className="text-faint text-[11px] mb-2.5">No coding-agent CLI found on your PATH. Install one below, then Rescan.</div>}
          {installed.map((a) => {
            const active = s.modelSource === "cli" && a.id === s.agent;
            return (
              <div key={a.id} className={"flex gap-2.5 items-start p-[11px] mb-2 rounded-[10px] border bg-bg2 cursor-pointer relative hover:border-focus " + (active ? "border-accent shadow-[inset_3px_0_0_var(--color-accent)]" : "border-line")} onClick={() => pickAgent(a.id)}>
                <div className="flex-none w-[30px] h-[30px] rounded-lg grid place-items-center font-bold text-sm text-[#0a0a0a]" style={{ background: ICO_BG[a.id] || "#888" }}>{(a.label || a.id).charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[7px] flex-wrap">
                    <b className="text-[13px]">{a.label}</b>
                    {a.id === "claude" && <span className="text-[9.5px] font-semibold px-1.5 py-px rounded-full tracking-wide bg-accent/15 text-accent">Recommended</span>}
                    {a.sandbox === "soft" && <span className="text-[9.5px] font-semibold px-1.5 py-px rounded-full tracking-wide bg-warn/15 text-warn">⚠ Soft sandbox</span>}
                  </div>
                  <div className="text-faint text-[11.5px] mt-0.5">{a.tagline}</div>
                  {a.id === "qwen" && active && (
                    <div className="mt-[9px] flex flex-col gap-[7px]" onClick={(e) => e.stopPropagation()}>
                      <input className={TXTIN} type="text" placeholder="Base URL — http://localhost:11434/v1" defaultValue={s.localBaseUrl} onBlur={(e) => change({ localBaseUrl: e.target.value.trim() })} />
                      <input className={TXTIN} type="text" placeholder="Model — e.g. qwen2.5-coder" defaultValue={s.localModel} onBlur={(e) => change({ localModel: e.target.value.trim() })} />
                    </div>
                  )}
                </div>
                <div className={"flex-none text-accent text-[15px] " + (active ? "opacity-100" : "opacity-0")}>✓</div>
              </div>
            );
          })}
          {missing.length > 0 && (
            <details className="border border-line rounded-[9px] my-2.5 overflow-hidden [&_summary]:list-none">
              <summary className="cursor-pointer px-3 py-2.5 text-[12px] text-muted flex items-center gap-1.5 marker:hidden">▸ Installable ({missing.length})</summary>
              <div className="grid grid-cols-1 gap-2 px-3 pb-3">
                {missing.map((a) => (
                  <div key={a.id} className="border border-line rounded-[9px] p-2.5 bg-bg3">
                    <div className="flex items-center gap-2">
                      <b className="text-[12.5px]">{a.label}</b>
                      {a.homepage && <a className="ml-auto text-link no-underline hover:underline" href={a.homepage} target="_blank" rel="noreferrer">↗</a>}
                    </div>
                    <div className="text-faint text-[11px] mt-0.5">{a.tagline}</div>
                    {a.installHint && <CopyCmd cmd={a.installHint} />}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div>
          <div className="text-faint text-[11px] mt-0.5 mb-2.5">Bring your own API key. Hover injects it into the protocol's matching CLI — that CLI must be installed.</div>
          <div className={FLBL}>Protocol</div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PROTOCOLS.map((it) => (<button key={it.id} className={chip(it.id === s.byok.protocol)} onClick={() => setProtocol(it.id)}>{it.label}</button>))}
          </div>
          <div className={FLBL}>Gateway <span className="text-[11px] text-faint">optional</span></div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {GATEWAYS.map((g) => (<button key={g.id} className={chip(g.id === s.byok.gateway)} onClick={() => toggleGateway(g.id)}>{g.label}</button>))}
          </div>

          <div className="text-[13px] font-semibold mt-1.5 mb-0.5">{p.sec}</div>
          <div className="text-faint text-[11px] mb-1.5">Driven via {p.cli} — it must be installed.</div>

          <div className={FLBL}>API Key <span className="text-warn">*</span><a className="text-[11px] text-link no-underline hover:underline" href={p.getkey} target="_blank" rel="noreferrer">Get a key ↗</a></div>
          <div className="flex gap-1.5">
            <input className={TXTIN + " flex-1"} type={keyShown ? "text" : "password"} placeholder={p.keyPh} value={keyText}
              onChange={(e) => { keyTouched.current = true; setKeyText(e.target.value); }} onBlur={(e) => onKeyChange(e.target.value)} />
            <button className="flex-none bg-bg2 border border-line rounded-[7px] text-muted px-[11px] text-[12px] cursor-pointer hover:text-fg hover:border-focus" onClick={() => {
              if (!keyShown && s.byok.hasKey && keyText.indexOf("•") === 0) { setKeyText(""); setKeyShown(true); return; }
              setKeyShown((v) => !v);
            }}>{keyShown ? "Hide" : "Show"}</button>
          </div>
          <div className={FHINT}>Stored in VS Code SecretStorage, on this machine only.</div>

          <div className={FLBL}>Base URL <span className="text-warn">*</span></div>
          <input className={TXTIN} type="text" placeholder={p.base} value={s.byok.baseUrl} onChange={(e) => setByok({ baseUrl: e.target.value })} onBlur={(e) => change({ byokBaseUrl: e.target.value.trim() })} />
          <div className={FHINT}>Default endpoint — usually no need to change.</div>

          <div className={FLBL}>Max tokens <span className="text-[11px] text-faint">optional</span></div>
          <input className={TXTIN} type="number" min={0} placeholder="model default" value={s.byok.maxTokens || ""}
            onChange={(e) => { const n = parseInt(e.target.value, 10); setByok({ maxTokens: isNaN(n) || n < 0 ? 0 : n }); }}
            onBlur={(e) => { const n = parseInt(e.target.value, 10); change({ byokMaxTokens: isNaN(n) || n < 0 ? 0 : n }); }} />
          <div className={FHINT}>Response length cap. Leave empty to use the model's default.</div>

          <div className={FLBL}>Model <span className="text-warn">*</span></div>
          <input className={TXTIN} type="text" placeholder={p.model} value={s.byok.model} onChange={(e) => setByok({ model: e.target.value })} onBlur={(e) => change({ byokModel: e.target.value.trim() })} />
        </div>
      )}

      <div className={SEC + " mt-4"}>General</div>
      <div className={ROW}>
        <div className="flex flex-col gap-0.5">Speech narration<span className="text-faint text-[11px]">Speak tool calls + the summary aloud</span></div>
        <Toggle checked={s.speech} onChange={(v) => { setS((p2) => ({ ...p2, speech: v })); change({ speech: v }); }} />
      </div>
      {s.speech && (
        <>
          <div className={ROW}>
            <div className="flex flex-col gap-0.5">Chinese voice<span className="text-faint text-[11px]">For Chinese narration (e.g. Tingting)</span></div>
            <select className="bg-bg3 text-fg border border-line rounded-md px-2 py-[5px] max-w-[150px]" value={s.voiceZh}
              onChange={(e) => { setS((p2) => ({ ...p2, voiceZh: e.target.value })); change({ voiceZh: e.target.value }); }}>
              <option value="">Auto</option>
              {voices
                .filter((v) => v.lang.toLowerCase().startsWith("zh") && /tingting|婷婷|meijia|美佳/i.test(v.name))
                .map((v) => (
                  <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                ))}
            </select>
          </div>
          <div className={ROW}>
            <div className="flex flex-col gap-0.5">English voice<span className="text-faint text-[11px]">For English narration (e.g. Samantha)</span></div>
            <select className="bg-bg3 text-fg border border-line rounded-md px-2 py-[5px] max-w-[150px]" value={s.voiceEn}
              onChange={(e) => { setS((p2) => ({ ...p2, voiceEn: e.target.value })); change({ voiceEn: e.target.value }); }}>
              <option value="">Auto</option>
              {voices
                .filter((v) => v.lang.toLowerCase().startsWith("en") &&
                  !/albert|bahh|bells|boing|bubbles|cellos|fred|jester|junior|organ|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|news/i.test(v.name))
                .map((v) => (
                  <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                ))}
            </select>
          </div>
        </>
      )}
      <div className={ROW}>
        <div className="flex flex-col gap-0.5">Browser<span className="text-faint text-[11px]">Headless = no window; Normal = shown Chrome</span></div>
        <select className="bg-bg3 text-fg border border-line rounded-md px-2 py-[5px]" value={s.browser} onChange={(e) => { setS((p2) => ({ ...p2, browser: e.target.value })); change({ browser: e.target.value }); }}>
          <option value="silent">Headless</option><option value="visible">Normal</option>
        </select>
      </div>
      <div className={ROW}>
        <div className="flex flex-col gap-0.5">Memory<span className="text-faint text-[11px]">Shared = the agent reads your CLAUDE.md + Claude Code memory; Isolated = clean, private runs. Your login is unaffected.</span></div>
        <select className="bg-bg3 text-fg border border-line rounded-md px-2 py-[5px]" value={s.agentContext} onChange={(e) => { setS((p2) => ({ ...p2, agentContext: e.target.value })); change({ agentContext: e.target.value }); }}>
          <option value="shared">Same as Claude Code</option><option value="isolated">Isolated</option>
        </select>
      </div>
      <div className={ROW}>
        <div className="flex flex-col gap-0.5 opacity-65">Hover Cloud<span className="text-faint text-[11px]">Cross-machine sync, team environments, run dashboards — coming soon.</span></div>
        <button className="flex-none whitespace-nowrap inline-flex items-center gap-1.5 bg-bg3 text-muted border border-line rounded-md px-3 py-1.5 text-[12px] opacity-60 cursor-not-allowed" disabled title="Coming with Hover Cloud">☁ Sign in</button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative w-[38px] h-[22px] flex-none">
      <input type="checkbox" className="peer hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="absolute inset-0 bg-line rounded-full cursor-pointer transition-all duration-150 peer-checked:bg-accent before:content-[''] before:absolute before:w-4 before:h-4 before:left-[3px] before:top-[3px] before:bg-white before:rounded-full before:transition-all before:duration-150 peer-checked:before:translate-x-4" />
    </label>
  );
}

function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <code className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] bg-bg border border-line rounded-md px-[7px] py-[5px] text-muted">{cmd}</code>
      <button className="flex-none bg-bg2 border border-line rounded-md text-muted px-2 py-[5px] text-[11px] cursor-pointer hover:text-fg" onClick={() => { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
