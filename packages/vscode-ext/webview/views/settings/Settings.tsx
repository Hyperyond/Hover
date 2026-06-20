import { useEffect, useRef, useState } from "react";
import { post, onMessage } from "../../shared/vscode";
import "./settings.css";

/**
 * Settings view — React port of the former string-template settingsView.
 * Two-tab model config (Local CLI / BYOK) + general toggles. Same message
 * protocol as before: posts `{type:'ready'}` on mount and `{type:'change', …}`
 * per edit; receives `{type:'state', …}` from the extension.
 */

interface AgentItem {
  id: string;
  label: string;
  tagline: string;
  installed: boolean;
  sandbox?: string;
  installHint: string;
  homepage: string;
}
interface ByokState {
  protocol: string;
  gateway: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  hasKey: boolean;
}
interface State {
  modelSource: "cli" | "byok";
  agent: string;
  agents: AgentItem[];
  speech: boolean;
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
// OpenAI-compatible aggregators — selecting one prefills an editable base URL.
const GATEWAYS = [
  { id: "ollama-cloud", label: "Ollama Cloud", base: "https://ollama.com/v1" },
  { id: "sense", label: "SenseAudio", base: "" },
  { id: "aihubmix", label: "AIHubMix", base: "https://aihubmix.com/v1" },
];
const ICO_BG: Record<string, string> = { claude: "#d97757", codex: "#10a37f", gemini: "#4285f4", qwen: "#7CFFA8" };

const proto = (id: string) => PROTOCOLS.find((p) => p.id === id) ?? PROTOCOLS[0];

const DEFAULT_BYOK: ByokState = { protocol: "anthropic", gateway: "none", baseUrl: "", model: "", maxTokens: 0, hasKey: false };

export function Settings() {
  const [s, setS] = useState<State>({
    modelSource: "cli",
    agent: "claude",
    agents: [],
    speech: false,
    browser: "silent",
    agentContext: "shared",
    localBaseUrl: "",
    localModel: "",
    byok: DEFAULT_BYOK,
  });
  // Key field: when a stored key exists we show a mask the user can't reveal
  // (we never receive the secret) — typing replaces it.
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

  const selectTab = (src: "cli" | "byok") => {
    setS((p) => ({ ...p, modelSource: src }));
    change({ modelSource: src });
  };
  const pickAgent = (id: string) => {
    setS((p) => ({ ...p, modelSource: "cli", agent: id }));
    change({ modelSource: "cli", agent: id });
  };
  const setProtocol = (id: string) => {
    setByok({ protocol: id, gateway: "none", baseUrl: "" });
    change({ byokProtocol: id, byokGateway: "none", byokBaseUrl: "" });
  };
  const toggleGateway = (id: string) => {
    const on = s.byok.gateway === id;
    const g = GATEWAYS.find((x) => x.id === id);
    const gateway = on ? "none" : id;
    const baseUrl = on ? "" : g?.base || "";
    setByok({ gateway, baseUrl });
    change({ byokGateway: gateway, byokBaseUrl: baseUrl });
  };
  const onKeyChange = (v: string) => {
    if (v.indexOf("•") === 0) return; // untouched mask
    setByok({ hasKey: !!v.trim() });
    change({ byokApiKey: v.trim() });
  };

  const installed = s.agents.filter((a) => a.installed);
  const missing = s.agents.filter((a) => !a.installed);
  const p = proto(s.byok.protocol);

  return (
    <div className="settings">
      <div className="sec-title">Model</div>
      <div className="tabs">
        <button className={"tab" + (s.modelSource === "cli" ? " active" : "")} onClick={() => selectTab("cli")}>Local CLI</button>
        <button className={"tab" + (s.modelSource === "byok" ? " active" : "")} onClick={() => selectTab("byok")}>BYOK</button>
      </div>

      {s.modelSource === "cli" ? (
        <div className="panel active">
          <div className="hint">The coding-agent CLI that drives runs, using its own logged-in subscription.</div>
          <div className="cli-head">
            <span className="t">Your CLIs ({installed.length})</span>
            <button className="lnkbtn" onClick={() => change({ rescan: true })}>↻ Rescan</button>
          </div>
          {installed.length === 0 && (
            <div className="hint">No coding-agent CLI found on your PATH. Install one below, then Rescan.</div>
          )}
          {installed.map((a) => {
            const active = s.modelSource === "cli" && a.id === s.agent;
            return (
              <div key={a.id} className={"card" + (active ? " active" : "")} onClick={() => pickAgent(a.id)}>
                <div className="ico" style={{ background: ICO_BG[a.id] || "#888" }}>{(a.label || a.id).charAt(0).toUpperCase()}</div>
                <div className="body">
                  <div className="nm">
                    <b>{a.label}</b>
                    {a.id === "claude" && <span className="pill rec">Recommended</span>}
                    {a.sandbox === "soft" && <span className="pill soft">⚠ Soft sandbox</span>}
                  </div>
                  <div className="tg">{a.tagline}</div>
                  {a.id === "qwen" && active && (
                    <div className="local-fields" onClick={(e) => e.stopPropagation()}>
                      <input className="txtin" type="text" placeholder="Base URL — http://localhost:11434/v1" defaultValue={s.localBaseUrl}
                        onBlur={(e) => change({ localBaseUrl: e.target.value.trim() })} />
                      <input className="txtin" type="text" placeholder="Model — e.g. qwen2.5-coder" defaultValue={s.localModel}
                        onBlur={(e) => change({ localModel: e.target.value.trim() })} />
                    </div>
                  )}
                </div>
                <div className="check">✓</div>
              </div>
            );
          })}
          {missing.length > 0 && (
            <details className="fold">
              <summary><span className="caret">▸</span> Installable ({missing.length})</summary>
              <div className="grid">
                {missing.map((a) => (
                  <div key={a.id} className="icard">
                    <div className="nm">
                      <b>{a.label}</b>
                      {a.homepage && <a href={a.homepage} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>↗</a>}
                    </div>
                    <div className="tg">{a.tagline}</div>
                    {a.installHint && <CopyCmd cmd={a.installHint} />}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="panel active">
          <div className="hint">Bring your own API key. Hover injects it into the protocol's matching CLI — that CLI must be installed.</div>
          <div className="flbl">Protocol</div>
          <div className="pills">
            {PROTOCOLS.map((it) => (
              <button key={it.id} className={"pchip" + (it.id === s.byok.protocol ? " on" : "")} onClick={() => setProtocol(it.id)}>{it.label}</button>
            ))}
          </div>
          <div className="flbl">Gateway <span className="aux" style={{ color: "var(--dim)" }}>optional</span></div>
          <div className="pills">
            {GATEWAYS.map((g) => (
              <button key={g.id} className={"pchip" + (g.id === s.byok.gateway ? " on" : "")} onClick={() => toggleGateway(g.id)}>{g.label}</button>
            ))}
          </div>

          <div className="byok-sec">{p.sec}</div>
          <div className="fhint" style={{ marginBottom: 6 }}>Driven via {p.cli} — it must be installed.</div>

          <div className="flbl">API Key <span className="req">*</span><a className="aux" href={p.getkey} target="_blank" rel="noreferrer">Get a key ↗</a></div>
          <div className="ingrp">
            <input className="txtin" type={keyShown ? "text" : "password"} placeholder={p.keyPh} value={keyText}
              onChange={(e) => { keyTouched.current = true; setKeyText(e.target.value); }}
              onBlur={(e) => onKeyChange(e.target.value)} />
            <button className="smbtn" onClick={() => {
              if (!keyShown && s.byok.hasKey && keyText.indexOf("•") === 0) { setKeyText(""); setKeyShown(true); return; }
              setKeyShown((v) => !v);
            }}>{keyShown ? "Hide" : "Show"}</button>
          </div>
          <div className="fhint">Stored in VS Code SecretStorage, on this machine only.</div>

          <div className="flbl">Base URL <span className="req">*</span></div>
          <input className="txtin" type="text" placeholder={p.base} value={s.byok.baseUrl}
            onChange={(e) => setByok({ baseUrl: e.target.value })}
            onBlur={(e) => change({ byokBaseUrl: e.target.value.trim() })} />
          <div className="fhint">Default endpoint — usually no need to change.</div>

          <div className="flbl">Max tokens <span className="aux" style={{ color: "var(--dim)" }}>optional</span></div>
          <input className="txtin" type="number" min={0} placeholder="model default" value={s.byok.maxTokens || ""}
            onChange={(e) => { const n = parseInt(e.target.value, 10); setByok({ maxTokens: isNaN(n) || n < 0 ? 0 : n }); }}
            onBlur={(e) => { const n = parseInt(e.target.value, 10); change({ byokMaxTokens: isNaN(n) || n < 0 ? 0 : n }); }} />
          <div className="fhint">Response length cap. Leave empty to use the model's default.</div>

          <div className="flbl">Model <span className="req">*</span></div>
          <input className="txtin" type="text" placeholder={p.model} value={s.byok.model}
            onChange={(e) => setByok({ model: e.target.value })}
            onBlur={(e) => change({ byokModel: e.target.value.trim() })} />
        </div>
      )}

      <div className="sec-title" style={{ marginTop: 16 }}>General</div>
      <div className="row">
        <div className="label">Speech narration<span className="sub">Speak tool calls + the summary aloud</span></div>
        <label className="switch"><input type="checkbox" checked={s.speech} onChange={(e) => { setS((p2) => ({ ...p2, speech: e.target.checked })); change({ speech: e.target.checked }); }} /><span className="slider" /></label>
      </div>
      <div className="row">
        <div className="label">Browser<span className="sub">Headless = no window; Normal = shown Chrome</span></div>
        <select value={s.browser} onChange={(e) => { setS((p2) => ({ ...p2, browser: e.target.value })); change({ browser: e.target.value }); }}>
          <option value="silent">Headless</option>
          <option value="visible">Normal</option>
        </select>
      </div>
      <div className="row">
        <div className="label">Memory<span className="sub">Shared = the agent reads your CLAUDE.md + Claude Code memory; Isolated = clean, private runs. Your login is unaffected.</span></div>
        <select value={s.agentContext} onChange={(e) => { setS((p2) => ({ ...p2, agentContext: e.target.value })); change({ agentContext: e.target.value }); }}>
          <option value="shared">Same as Claude Code</option>
          <option value="isolated">Isolated</option>
        </select>
      </div>
      <div className="row cloud">
        <div className="label">Hover Cloud<span className="sub">Cross-machine sync, team environments, run dashboards — coming soon.</span></div>
        <button className="cloudbtn" disabled title="Coming with Hover Cloud">☁ Sign in</button>
      </div>
    </div>
  );
}

function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code>{cmd}</code>
      <button className="copy" onClick={() => { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
