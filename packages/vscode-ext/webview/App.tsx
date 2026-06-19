import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { post, onMessage } from "./vscode";
import { Header } from "./Header";
import { Splash } from "./Splash";
import { Composer } from "./Composer";
import { Thread } from "./Thread";
import { useThread } from "./useThread";
import { AskCard, type AskReq } from "./AskCard";

export interface ModelOption {
  value: string;
  label: string;
  desc?: string;
  disabled?: boolean;
}

export interface Account {
  label: string;
  role?: string;
  username?: string;
}

export interface SessionInfo {
  id: string;
  name: string;
  running?: boolean;
}

/**
 * Chat shell (React migration, stage 3): header + log/splash + composer, with
 * state driven by the SAME messages the extension already sends. The run thread
 * (streaming narration / steps / result) is the next stage; for now the log
 * shows the empty-state splash.
 */
export function App() {
  const [draft, setDraft] = useState("");
  const [app, setApp] = useState<{ online: boolean; label: string }>({ online: false, label: "" });
  const [modelLabel, setModelLabel] = useState("");
  const [modeLabel, setModeLabel] = useState("Flow");
  const [modeId, setModeId] = useState<string | null>(null);
  const [silent, setSilent] = useState(true);
  const [running, setRunning] = useState(false);
  const [sessionLabel, setSessionLabel] = useState("New session");
  const [ask, setAsk] = useState<AskReq | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [modelLocked, setModelLocked] = useState(false);
  const [effortOpts, setEffortOpts] = useState<string[]>([]);
  const [curEffort, setCurEffort] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSess, setActiveSess] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { items, workLabel } = useThread();
  // The live indicator at the foot of the thread: a timed busy job (optimize), or
  // — while a run streams between steps — a label that tracks the agent's current
  // operation (workLabel, e.g. "Clicking" / "Reading source"), falling back to
  // "Working" before the first step lands.
  const working = busy != null ? { text: busy, timer: true } : running ? { text: workLabel || "Working", timer: false } : null;

  // Running chrome: a `running` body class + the silent-mode rotating border
  // (only when headless — the browser is invisible, so the border signals work).
  useEffect(() => {
    document.body.classList.toggle("running", running);
    document.body.classList.toggle("silent-running", running && silent);
  }, [running, silent]);
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the thread pinned to the bottom as it streams.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // While an ask is open the composer is hidden and the ask-dock takes its place
  // (the CSS keys off body.ask-open, matching the legacy webview).
  useEffect(() => {
    document.body.classList.toggle("ask-open", !!ask);
  }, [ask]);

  function resolveAsk(value: string | null) {
    if (!ask) return;
    post({ type: "askUserAnswer", askId: ask.askId, value });
    // Drop a local "You answered: …" node onto the thread.
    window.postMessage({ type: "_answered", text: value == null ? "You dismissed the question" : "You answered: " + value }, "*");
    setAsk(null);
  }

  useEffect(() => {
    post({ type: "ready" });
    return onMessage((raw) => {
      const m = raw as Record<string, unknown>;
      switch (m.type) {
        case "appstatus":
          setApp({ online: !!m.online, label: String(m.label ?? "") });
          break;
        case "mode": {
          const id = m.id ? String(m.id) : null;
          setModeId(id);
          setModeLabel(id ? String(m.label ?? id) : "Flow");
          document.body.classList.remove("mode-api-test", "mode-pentest");
          if (id) document.body.classList.add("mode-" + id);
          break;
        }
        case "models": {
          const list = Array.isArray(m.models) ? (m.models as ModelOption[]) : [];
          const cur = list.find((x) => x.value === m.current);
          const eff = (m.effort as { options?: string[]; current?: string } | undefined) ?? {};
          setModels(list);
          setCurrentModel(String(m.current ?? ""));
          setModelLocked(!!m.locked);
          setModelLabel(cur?.label ?? String(m.current ?? ""));
          setEffortOpts(Array.isArray(eff.options) ? eff.options : []);
          setCurEffort(String(eff.current ?? ""));
          break;
        }
        case "askUser":
          setAsk({
            askId: String(m.askId ?? ""),
            question: String(m.question ?? ""),
            options: Array.isArray(m.options) ? (m.options as AskReq["options"]) : [],
            other: m.other as boolean | undefined,
          });
          break;
        case "config":
          setSilent(!!m.silent);
          break;
        case "sessions": {
          const list = Array.isArray(m.list) ? (m.list as SessionInfo[]) : [];
          const activeId = String(m.activeId ?? "");
          setSessions(list);
          setActiveSess(activeId);
          const active = list.find((s) => s.id === activeId);
          if (active?.name) setSessionLabel(active.name);
          break;
        }
        case "accounts":
          setAccounts(Array.isArray(m.accounts) ? (m.accounts as Account[]) : []);
          break;
        case "running":
          setRunning(!!m.running);
          break;
        case "busy":
          setBusy(m.done ? null : String(m.text || "Working…"));
          break;
        case "result":
          setRunning(false);
          setAsk(null);
          break;
        case "reset":
          setRunning(false);
          setAsk(null);
          setBusy(null);
          break;
      }
    });
  }, []);

  return (
    <>
      <Header
        sessionLabel={sessionLabel}
        appOnline={app.online}
        appLabel={app.label}
        sessions={sessions}
        activeSess={activeSess}
      />
      <div id="log" ref={logRef}>
        {items.length === 0 && !working ? (
          <Splash onPick={setDraft} />
        ) : (
          <Thread items={items} working={working} />
        )}
      </div>
      <div id="ask-dock" hidden={!ask}>
        {ask && <AskCard ask={ask} onResolve={resolveAsk} />}
      </div>
      <Composer
        draft={draft}
        setDraft={setDraft}
        modelLabel={modelLabel}
        modeLabel={modeLabel}
        modeId={modeId}
        silent={silent}
        running={running}
        models={models}
        currentModel={currentModel}
        modelLocked={modelLocked}
        effortOpts={effortOpts}
        curEffort={curEffort}
        accounts={accounts}
      />
    </>
  );
}
