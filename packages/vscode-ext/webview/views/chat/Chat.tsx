import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { post, onMessage } from "../../shared/vscode";
import { Header } from "./Header";
import { Splash } from "./Splash";
import { Composer } from "./Composer";
import { Thread } from "./Thread";
import { useThread } from "./useThread";
import { AskCard, type AskReq } from "./AskCard";

/** Pick the smoothest available voice for the language, preferring known
 *  natural (usually female) system voices by name and avoiding the robotic
 *  "compact"/novelty ones the OS otherwise returns first. */
function pickVoice(voices: SpeechSynthesisVoice[], zh: boolean): SpeechSynthesisVoice | undefined {
  const inLang = voices.filter((v) => v.lang?.toLowerCase().startsWith(zh ? "zh" : "en"));
  if (!inLang.length) return undefined;
  // Preferred smooth voices, in order (macOS + Chromium common names).
  const prefer = zh
    ? ["tingting", "ting-ting", "婷婷", "meijia", "美佳", "sinji", "google 普通话", "google 国语", "yue", "huihui"]
    : ["samantha", "google us english", "karen", "aria", "jenny", "alex", "daniel"];
  for (const needle of prefer) {
    const v = inLang.find((x) => x.name?.toLowerCase().includes(needle));
    if (v) return v;
  }
  // Otherwise avoid the obviously robotic/novelty ones.
  return inLang.find((v) => !/compact|eloquence|fred|albert|zarvox|whisper/i.test(v.name || "")) || inLang[0];
}

/** Voice narration — speak one interim line via the webview's SpeechSynthesis
 *  when the speech setting is on. Chinese text picks a Chinese voice, else
 *  English (mirrors the engine's CJK prose detection). Best-effort: a no-op if
 *  the host has no speech synthesis. */
function speakLine(text: string, chosenZh = "", chosenEn = ""): void {
  try {
    const synth = window.speechSynthesis;
    const t = text.trim();
    if (!synth || !t) return;
    const zh = /[一-鿿]/.test(t);
    const u = new SpeechSynthesisUtterance(t);
    u.lang = zh ? "zh-CN" : "en-US";
    const voices = synth.getVoices();
    // The user's explicit pick for this language wins; else auto-pick a smooth one.
    const chosen = zh ? chosenZh : chosenEn;
    const voice = (chosen && voices.find((v) => v.name === chosen)) || pickVoice(voices, zh);
    if (voice) u.voice = voice;
    u.rate = 1.05; // a touch quicker reads more natural for short status lines
    synth.speak(u);
  } catch {
    /* speech unavailable in this host — ignore */
  }
}

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
export function Chat() {
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
  const [qaIntensity, setQaIntensity] = useState("standard");
  const [qaApi, setQaApi] = useState(true);
  const [qaApiAvailable, setQaApiAvailable] = useState(false);
  const [qaPentest, setQaPentest] = useState(false);
  const [qaPentestAvailable, setQaPentestAvailable] = useState(false);
  // Speech-narration flag + chosen voices as refs — the onMessage handler is set
  // up once, so it reads the live values here rather than a stale closure.
  const speechRef = useRef(false);
  const voiceZhRef = useRef("");
  const voiceEnRef = useRef("");
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
  const stuckRef = useRef(true); // is the view pinned to (near) the bottom?
  const prevLenRef = useRef(0);

  // The live working indicator (spinner + icon + label) renders BELOW the items,
  // so its appearance / label change grows the log too — fold it into the scroll
  // trigger, or it lands below the fold right after a send (the bottom icon you
  // couldn't see).
  const workingKey = working ? working.text : null;

  // Follow the stream only while the user is at the bottom. If they scrolled up
  // to read history, new content does NOT yank them down — UNLESS they just sent
  // a message (then re-pin). Scrolling is smooth.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const grew = items.length > prevLenRef.current;
    prevLenRef.current = items.length;
    const userSent = grew && items[items.length - 1]?.kind === "user";
    if (userSent) stuckRef.current = true; // a fresh send always re-pins
    if (userSent || stuckRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, workingKey]);

  // Track whether the user is near the bottom (so streaming can stop following
  // once they scroll up).
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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
          document.body.classList.remove("mode-api-test", "mode-pentest", "mode-qa");
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
        case "qaIntensity":
          setQaIntensity(String(m.value ?? "standard"));
          break;
        case "qaApi":
          setQaApi(m.value !== false);
          break;
        case "qaPentest":
          setQaPentest(m.value === true);
          break;
        case "qaCapabilityAvailable":
          setQaApiAvailable(m.api === true);
          setQaPentestAvailable(m.pentest === true);
          break;
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
          speechRef.current = !!m.speech;
          voiceZhRef.current = String(m.voiceZh || "");
          voiceEnRef.current = String(m.voiceEn || "");
          if (!m.speech) window.speechSynthesis?.cancel?.();
          break;
        case "narration":
          // Voice narration: speak the agent's interim status line aloud.
          if (speechRef.current) speakLine(String(m.text || ""), voiceZhRef.current, voiceEnRef.current);
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
          if (!m.running) window.speechSynthesis?.cancel?.(); // run ended — stop any backlog
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
          window.speechSynthesis?.cancel?.();
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
        qaIntensity={qaIntensity}
        qaApi={qaApi}
        qaApiAvailable={qaApiAvailable}
        qaPentest={qaPentest}
        qaPentestAvailable={qaPentestAvailable}
        accounts={accounts}
      />
    </>
  );
}
