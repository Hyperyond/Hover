import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { post } from "../../shared/vscode";
import type { Account, ModelOption } from "./Chat";
import { MODES, modeIcon } from "./modes";

const SendIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/** QA intensity presets — mirrors core's QA_INTENSITY (label + spend ceiling).
 *  Bounds how far an exploratory QA run goes so it can't run away on cost. */
const QA_LEVELS = [
  { v: "quick", label: "Quick", desc: "Fast pass over main flows · ~20–45 steps" },
  { v: "standard", label: "Standard", desc: "Main flows + key negative tests · ~45–150 steps" },
  { v: "deep", label: "Deep", desc: "Exhaustive — every control & state · ~150–500 steps" },
];

/** The input box + toolbar (browser / model / mode / send). Browser, mode and
 *  send/stop hit existing extension commands; the model + @-mention popups are
 *  a later stage. */
export function Composer({
  draft,
  setDraft,
  modelLabel,
  modeLabel,
  modeId,
  silent,
  running,
  models,
  currentModel,
  modelLocked,
  effortOpts,
  curEffort,
  qaIntensity,
  qaApi,
  qaApiAvailable,
  qaPentest,
  qaPentestAvailable,
  accounts,
}: {
  draft: string;
  setDraft: (t: string) => void;
  modelLabel: string;
  modeLabel: string;
  modeId: string | null;
  silent: boolean;
  running: boolean;
  models: ModelOption[];
  currentModel: string;
  modelLocked: boolean;
  effortOpts: string[];
  curEffort: string;
  qaIntensity: string;
  qaApi: boolean;
  qaApiAvailable: boolean;
  qaPentest: boolean;
  qaPentestAvailable: boolean;
  accounts: Account[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [modelMenu, setModelMenu] = useState(false);
  const [modeMenu, setModeMenu] = useState(false);
  const [intensityMenu, setIntensityMenu] = useState(false);
  // @account autocomplete: the menu + which item is highlighted + where the
  // active @token starts in the text.
  const [mention, setMention] = useState<{ items: Account[]; sel: number; start: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);

  // After inserting a mention, restore the caret to just past it.
  useLayoutEffect(() => {
    if (pendingCaret.current != null && ref.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    }
  }, [draft]);

  function onInput(value: string, caret: number) {
    setDraft(value);
    const m = /@([A-Za-z0-9_-]*)$/.exec(value.slice(0, caret));
    if (m && accounts.length) {
      const low = m[1].toLowerCase();
      const items = accounts.filter((a) => a.label.toLowerCase().startsWith(low));
      if (items.length) {
        setMention({ items, sel: 0, start: caret - m[0].length });
        return;
      }
    }
    setMention(null);
  }

  function insertMention(a: Account) {
    const el = ref.current;
    const caret = el?.selectionStart ?? draft.length;
    const start = mention?.start ?? caret;
    const inserted = "@" + a.label + " ";
    setDraft(draft.slice(0, start) + inserted + draft.slice(caret));
    pendingCaret.current = start + inserted.length;
    setMention(null);
  }

  // Close the model menu on any outside click.
  useEffect(() => {
    if (!modelMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("#model-btn, #model-menu")) setModelMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [modelMenu]);

  function pickModel(value: string) {
    setModelMenu(false);
    if (value !== currentModel) post({ type: "setModel", value });
  }

  // Close the mode menu on any outside click.
  useEffect(() => {
    if (!modeMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("#mode, #mode-menu")) setModeMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [modeMenu]);

  function pickMode(value: string) {
    setModeMenu(false);
    post({ type: "setMode", modeId: value === "normal" ? null : value });
  }

  // QA intensity menu (QA mode only) — bounds how hard an exploration tries.
  useEffect(() => {
    if (!intensityMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("#intensity-btn, #intensity-menu")) setIntensityMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [intensityMenu]);

  function pickIntensity(value: string) {
    setIntensityMenu(false);
    if (value !== qaIntensity) post({ type: "setQaIntensity", value });
  }

  // Auto-grow the textarea up to a cap, mirroring the legacy behaviour.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);

  function submit() {
    if (running) {
      post({ type: "command", id: "hover.cancelRun" });
      return;
    }
    const t = draft.trim();
    if (!t) return;
    post({ type: "send", text: t });
    setDraft("");
  }

  return (
    <div id="composer">
      <div id="box">
        <div className="inputrow">
          {mention && (
            <div className="mentions" id="mentions">
              {mention.items.map((a, i) => (
                <div
                  key={a.label}
                  className={"m-item" + (i === mention.sel ? " sel" : "")}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(a);
                  }}
                >
                  <span className="m-label">@{a.label}</span>
                  {(a.role || a.username) && (
                    <span className="m-sub">{[a.role, a.username].filter(Boolean).join(" · ")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <textarea
            id="input"
            ref={ref}
            rows={1}
            style={{ margin: "0px 10px 0" }}
            placeholder="e.g. test the login flow  ·  @account to log in"
            value={draft}
            onChange={(e) => onInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (mention) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMention((p) => (p ? { ...p, sel: (p.sel + 1) % p.items.length } : p));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMention((p) => (p ? { ...p, sel: (p.sel - 1 + p.items.length) % p.items.length } : p));
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insertMention(mention.items[mention.sel]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div id="toolbar">
          <div className="left">
            <button
              className="barebtn"
              title="Browser: Headless (no window) / Normal (shown) — click to toggle"
              onClick={() =>
                post({ type: "command", id: "hover.toggleBrowser" })
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                />
                <path
                  d="M24 6a18 18 0 0 1 15.6 9H24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
                <path
                  d="M8.4 15a18 18 0 0 0 7.8 26.4l7.8-13.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
                <path
                  d="M39.6 15a18 18 0 0 1-15.6 27l7.8-13.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
              </svg>
              <span>{silent ? "Headless" : "Normal"}</span>
            </button>
            <button
              className={"barebtn" + (modelLocked ? " locked" : "")}
              id="model-btn"
              title={modelLocked ? "Local LLM — model is set in Settings" : "Model — click to switch"}
              onClick={() => {
                if (!modelLocked && models.length) setModelMenu((o) => !o);
              }}
            >
              <span>{modelLabel || "Model"}</span>
            </button>
            {modelMenu && (
              <div className="popup" id="model-menu">
                <div className="p-hdr">Model</div>
                {models.map((o) => (
                  <div
                    key={o.value}
                    className={"p-item" + (o.value === currentModel ? " active" : "") + (o.disabled ? " disabled" : "")}
                    onClick={() => !o.disabled && pickModel(o.value)}
                  >
                    <div className="p-body">
                      <div className="p-title">
                        {o.label}
                        {o.disabled && <span className="p-tag"> Soon</span>}
                      </div>
                      {o.desc && <div className="p-desc">{o.desc}</div>}
                    </div>
                    <span className="p-check">✓</span>
                  </div>
                ))}
                {effortOpts.length > 0 && (
                  <>
                    <div className="p-hdr eff-hdr">Reasoning effort</div>
                    <div className="eff-row">
                      {effortOpts.map((lv) => (
                        <button
                          key={lv}
                          className={"eff-chip" + (lv === curEffort ? " active" : "")}
                          onClick={() => post({ type: "setEffort", value: lv })}
                        >
                          {lv}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {modeId === "qa" && (
              <>
                <button
                  className="barebtn"
                  id="intensity-btn"
                  title="QA intensity — how hard the exploration tries (bounds run cost)"
                  onClick={() => setIntensityMenu((o) => !o)}
                >
                  <span>{QA_LEVELS.find((l) => l.v === qaIntensity)?.label ?? "Standard"}</span>
                </button>
                {intensityMenu && (
                  <div className="popup" id="intensity-menu">
                    <div className="p-hdr">QA intensity</div>
                    {QA_LEVELS.map((l) => (
                      <div
                        key={l.v}
                        className={"p-item" + (l.v === qaIntensity ? " active" : "")}
                        onClick={() => pickIntensity(l.v)}
                      >
                        <div className="p-body">
                          <div className="p-title">{l.label}</div>
                          <div className="p-desc">{l.desc}</div>
                        </div>
                        <span className="p-check">✓</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className={"barebtn toggle" + (qaApi && qaApiAvailable ? " on" : "") + (qaApiAvailable ? "" : " locked")}
                  id="qa-api-btn"
                  title={
                    qaApiAvailable
                      ? "API testing — also inspect/replay/test the app's API calls (click to toggle)"
                      : "API testing unavailable — the api-test runtime isn't running"
                  }
                  onClick={() => {
                    if (qaApiAvailable) post({ type: "setQaApi", value: !qaApi });
                  }}
                >
                  <span>API {qaApiAvailable ? (qaApi ? "on" : "off") : "n/a"}</span>
                </button>
                <button
                  className={"barebtn toggle danger" + (qaPentest && qaPentestAvailable ? " on" : "") + (qaPentestAvailable ? "" : " locked")}
                  id="qa-pentest-btn"
                  title={
                    qaPentestAvailable
                      ? "Pentest — offensive scan of your OWN app (injection / IDOR / SSRF …). Mutually exclusive with API. Confirms before enabling."
                      : "Pentest unavailable — the pentest runtime isn't running"
                  }
                  onClick={() => {
                    if (qaPentestAvailable) post({ type: "setQaPentest", value: !qaPentest });
                  }}
                >
                  <span>Pentest {qaPentestAvailable ? (qaPentest ? "on" : "off") : "n/a"}</span>
                </button>
              </>
            )}
          </div>
          <div className="right">
            <button
              className="barebtn"
              id="mode"
              title="Switch mode (Flow / API testing / Pentest)"
              onClick={() => setModeMenu((o) => !o)}
            >
              <span className="bolt" dangerouslySetInnerHTML={{ __html: modeIcon(modeId) }} />
              <span>{modeLabel}</span>
            </button>
            {modeMenu && (
              <div className="popup" id="mode-menu">
                <div className="p-hdr">Mode</div>
                {MODES.map((it) => {
                  const active = it.value === (modeId || "normal");
                  return (
                    <div
                      key={it.value}
                      className={"p-item" + (active ? " active" : "")}
                      onClick={() => pickMode(it.value)}
                    >
                      <span className="p-ic" dangerouslySetInnerHTML={{ __html: it.icon }} />
                      <div className="p-body">
                        <div className="p-title">
                          {it.title}
                          {it.tag && <span className="p-tag"> {it.tag}</span>}
                        </div>
                        <div className="p-desc">{it.desc}</div>
                      </div>
                      <span className="p-check">✓</span>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              id="send"
              title={running ? "Stop" : "Send (Enter)"}
              disabled={!running && !draft.trim()}
              onClick={submit}
            >
              {running ? <StopIcon /> : <SendIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
