import { useEffect, useRef } from "react";
import { post } from "./vscode";

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/** The input box + toolbar (browser / model / mode / send). Browser, mode and
 *  send/stop hit existing extension commands; the model + @-mention popups are
 *  a later stage. */
export function Composer({
  draft,
  setDraft,
  modelLabel,
  modeLabel,
  silent,
  running,
}: {
  draft: string;
  setDraft: (t: string) => void;
  modelLabel: string;
  modeLabel: string;
  silent: boolean;
  running: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

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
          <textarea
            id="input"
            ref={ref}
            rows={1}
            placeholder="e.g. test the login flow  ·  @account to log in"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
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
              onClick={() => post({ type: "command", id: "hover.toggleBrowser" })}
            >
              <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
                <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth="3.2" />
                <path d="M24 6a18 18 0 0 1 15.6 9H24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
                <path d="M8.4 15a18 18 0 0 0 7.8 26.4l7.8-13.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
                <path d="M39.6 15a18 18 0 0 1-15.6 27l7.8-13.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
              </svg>
              <span>{silent ? "Headless" : "Normal"}</span>
            </button>
            <button className="barebtn" id="model-btn" title="Model">
              <span>{modelLabel || "Model"}</span>
            </button>
          </div>
          <div className="right">
            <button
              className="barebtn"
              id="mode"
              title="Switch mode (Frontend / API testing / Pentest)"
              onClick={() => post({ type: "command", id: "hover.switchMode" })}
            >
              <span className="bolt" />
              <span>{modeLabel}</span>
            </button>
            <button id="send" title={running ? "Stop" : "Send (Enter)"} disabled={!running && !draft.trim()} onClick={submit}>
              {running ? <StopIcon /> : <SendIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
