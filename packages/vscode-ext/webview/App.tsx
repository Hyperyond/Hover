import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { post, onMessage } from "./vscode";
import { Header } from "./Header";
import { Splash } from "./Splash";
import { Composer } from "./Composer";
import { Thread } from "./Thread";
import { useThread } from "./useThread";

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
  const [modeLabel, setModeLabel] = useState("Frontend");
  const [silent, setSilent] = useState(true);
  const [running, setRunning] = useState(false);
  const [sessionLabel, setSessionLabel] = useState("New session");
  const items = useThread();
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the thread pinned to the bottom as it streams.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  useEffect(() => {
    post({ type: "ready" });
    return onMessage((raw) => {
      const m = raw as Record<string, unknown>;
      switch (m.type) {
        case "appstatus":
          setApp({ online: !!m.online, label: String(m.label ?? "") });
          break;
        case "mode": {
          setModeLabel(String(m.label ?? "Frontend"));
          document.body.classList.remove("mode-api-test", "mode-pentest");
          if (m.id) document.body.classList.add("mode-" + String(m.id));
          break;
        }
        case "models": {
          const list = Array.isArray(m.models) ? (m.models as { value: string; label: string }[]) : [];
          const cur = list.find((x) => x.value === m.current);
          setModelLabel(cur?.label ?? String(m.current ?? ""));
          break;
        }
        case "config":
          setSilent(!!m.silent);
          break;
        case "sessions": {
          const list = Array.isArray(m.list) ? (m.list as { id: string; name: string }[]) : [];
          const active = list.find((s) => s.id === m.active);
          if (active?.name) setSessionLabel(active.name);
          break;
        }
        case "running":
          setRunning(true);
          break;
        case "result":
        case "reset":
          setRunning(false);
          break;
      }
    });
  }, []);

  return (
    <>
      <Header sessionLabel={sessionLabel} appOnline={app.online} appLabel={app.label} />
      <div id="log" ref={logRef}>
        {items.length === 0 ? <Splash onPick={setDraft} /> : <Thread items={items} />}
      </div>
      <Composer
        draft={draft}
        setDraft={setDraft}
        modelLabel={modelLabel}
        modeLabel={modeLabel}
        silent={silent}
        running={running}
      />
    </>
  );
}
