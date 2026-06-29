import { useState } from "react";
import { inline } from "../../shared/markdown";

export interface AskReq {
  askId: string;
  question: string;
  options: { label: string; description?: string }[];
  other?: boolean;
}

const PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

/** In-chat human-in-the-loop prompt (the agent's ask_user). Options + an
 *  always-present free-text row (unless other===false). Resolving sends the
 *  answer back and drops a "You answered: …" node on the thread. */
export function AskCard({ ask, onResolve }: { ask: AskReq; onResolve: (value: string | null) => void }) {
  const [other, setOther] = useState("");
  const submitOther = () => {
    const v = other.trim();
    if (v) onResolve(v);
  };
  return (
    <div className="ask" style={{ position: "relative" }}>
      {/* Dismiss (×) — same as Claude: closing interrupts/declines the prompt
          (sends a null answer → the run treats it as cancelled/denied). */}
      <button
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => onResolve(null)}
        style={{ position: "absolute", top: 4, right: 6, background: "none", border: "none", color: "inherit", opacity: 0.45, cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "2px 4px" }}
      >×</button>
      <div className="ask-q" dangerouslySetInnerHTML={{ __html: inline(ask.question || "Hover needs your input") }} />
      <div className="ask-opts">
        {ask.options
          .filter((o) => o && o.label)
          .map((o, i) => (
            <button className="ask-opt" key={i} onClick={() => onResolve(o.label)}>
              <span dangerouslySetInnerHTML={{ __html: inline(o.label) }} />
              {o.description && <small dangerouslySetInnerHTML={{ __html: inline(o.description) }} />}
            </button>
          ))}
      </div>
      {ask.other !== false && (
        <div className="ask-other-row">
          <span className="ask-pencil" dangerouslySetInnerHTML={{ __html: PENCIL }} />
          <input
            type="text"
            placeholder="Type your own answer…"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitOther();
              }
            }}
          />
          <button className="ask-go" title="Send" onClick={submitOther} dangerouslySetInnerHTML={{ __html: ARROW }} />
        </div>
      )}
    </div>
  );
}
