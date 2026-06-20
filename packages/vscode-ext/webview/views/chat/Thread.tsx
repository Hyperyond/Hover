import { Fragment, useEffect, useState } from "react";
import type { ThreadItem } from "./useThread";
import { inline, mdToHtml } from "../../shared/markdown";
import { structuredRows, textRows, sevClass } from "./findings";
import { stripHoverAsk } from "./followup";
import { post } from "../../shared/vscode";

const NODE_KINDS = new Set(["think", "op", "group", "answered", "shot"]);

/** Plain text from an inline()'d HTML string (for clipboard). */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';

/** Reveal text char-by-char on mount (only when `animate`) with a trailing
 *  caret — the live op line. Settled history renders instantly. */
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    let i = 0;
    const step = text.length > 48 ? 2 : 1;
    const iv = setInterval(() => {
      i = Math.min(i + step, text.length);
      setN(i);
      if (i >= text.length) clearInterval(iv);
    }, 18);
    return () => clearInterval(iv);
  }, [text, animate]);
  return <span className={n < text.length ? "typing" : ""}>{text.slice(0, n)}</span>;
}

/** Monochrome copy button; flips to a check on success. */
function CopyBtn({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={"copybtn" + (copied ? " copied" : "")}
      title={copied ? "Copied" : "Copy"}
      onClick={(e) => {
        e.stopPropagation();
        const txt = (getText() || "").trim();
        const done = () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        };
        try {
          navigator.clipboard?.writeText(txt).then(done, done);
        } catch {
          done();
        }
      }}
      dangerouslySetInnerHTML={{ __html: copied ? CHECK_SVG : COPY_SVG }}
    />
  );
}

/** The run thread: node-rail items (think / op / source-group) grouped into a
 *  `.run` rail, with user/system/assistant as plain messages and the Done block
 *  as a result card. A live "Working…" / busy node hangs off the same rail. */
export function Thread({
  items,
  working,
}: {
  items: ThreadItem[];
  working: { text: string; timer: boolean } | null;
}) {
  // Chunk consecutive node-items into a single `.run` so the rail connects them.
  const WORKING = Symbol("working");
  type Entry = ThreadItem | typeof WORKING;
  const chunks: { run: boolean; items: Entry[] }[] = [];
  for (const it of items) {
    const isNode = NODE_KINDS.has(it.kind);
    const tail = chunks[chunks.length - 1];
    if (tail && tail.run === isNode) tail.items.push(it);
    else chunks.push({ run: isNode, items: [it] });
  }
  // The live "Working…" is a node on the SAME rail — append it to the trailing
  // run chunk (or open one) so it lines up flush with the steps above.
  if (working) {
    const tail = chunks[chunks.length - 1];
    if (tail && tail.run) tail.items.push(WORKING);
    else chunks.push({ run: true, items: [WORKING] });
  }

  const last = items[items.length - 1];
  const renderEntry = (it: Entry, i: number) =>
    it === WORKING ? (
      <WorkingNode key="working" text={working!.text} timer={working!.timer} />
    ) : (
      <Node key={i} item={it} last={it === last} />
    );

  return (
    <>
      {chunks.map((chunk, ci) =>
        chunk.run ? (
          <div className="run" key={ci}>
            {chunk.items.map(renderEntry)}
          </div>
        ) : (
          <Fragment key={ci}>{chunk.items.map(renderEntry)}</Fragment>
        ),
      )}
    </>
  );
}

/** Live indicator on the thread rail — a spinning Chrome ring + a typed status,
 *  Claude-Code style (text + a blinking block cursor). The status `text` tracks
 *  the agent's actual operation ("Clicking" / "Reading source"); when it changes
 *  the cursor backspaces the mismatch and types the new label. A timed busy job
 *  (optimize) shows its fixed label + mm:ss. The block cursor is always present,
 *  so the line height never collapses between words. */
function WorkingNode({ text, timer }: { text: string; timer: boolean }) {
  const [s, setS] = useState(0); // busy-job elapsed seconds
  const [shown, setShown] = useState(""); // chars currently revealed

  // Busy-job elapsed timer.
  useEffect(() => {
    if (!timer) return;
    const start = Date.now();
    const iv = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [timer]);

  // Animate `shown` toward `text`: type forward while `shown` is a prefix of the
  // target, otherwise backspace one char. Settles (no timer) when they match —
  // leaving just the blinking cursor, so the height stays put between labels.
  useEffect(() => {
    if (timer) {
      setShown(text);
      return;
    }
    if (shown === text) return;
    const grow = text.startsWith(shown);
    const t = setTimeout(
      () => setShown(grow ? text.slice(0, shown.length + 1) : shown.slice(0, -1)),
      grow ? 45 : 25,
    );
    return () => clearTimeout(t);
  }, [shown, text, timer]);

  return (
    <div className="node op working">
      <span className="node-rail">
        <span className="work-ico" />
      </span>
      <div className="node-body work-status">
        <span>{timer ? text : shown}</span>
        {timer && (
          <span className="busy-time">
            {" "}
            {Math.floor(s / 60)}:{("0" + (s % 60)).slice(-2)}
          </span>
        )}
        <span className="work-cursor" />
      </div>
    </div>
  );
}

function Node({ item, last }: { item: ThreadItem; last: boolean }) {
  switch (item.kind) {
    case "user":
      return <div className="msg user">{item.text}</div>;
    case "system":
      return <div className="msg system">{item.text}</div>;
    case "assistant":
      return <div className="msg assistant">{stripHoverAsk(item.text)}</div>;
    case "think":
      return (
        <div className="node think">
          <span className="node-rail" />
          <div className="node-body" dangerouslySetInnerHTML={{ __html: inline(stripHoverAsk(item.text)) }} />
        </div>
      );
    case "op": {
      // Embolden the leading verb ("Clicked", "Filled", "Uploaded" …); the rest
      // (the target) types in for the live line.
      const verb = item.verb && item.text.startsWith(item.verb) ? item.verb : "";
      const rest = verb ? item.text.slice(verb.length) : item.text;
      return (
        <div className={"node op" + (item.error ? " error" : "")}>
          <span className="node-rail" />
          <div className="node-body">
            {verb && <span className="op-verb">{verb}</span>}
            <Typed text={rest} animate={last} />
          </div>
        </div>
      );
    }
    case "answered":
      return (
        <div className="node op answered">
          <span className="node-rail" />
          <div className="node-body" dangerouslySetInnerHTML={{ __html: inline(stripHoverAsk(item.text)) }} />
        </div>
      );
    case "group":
      return <GroupNode label={item.label} items={item.items} />;
    case "shot":
      return <ShotNode uri={item.uri} />;
    case "clarify":
      return <ClarifyBlock question={item.question} options={item.options} />;
    case "result":
      return <ResultBlock item={item} />;
  }
}

/** The agent is asking the user to choose — its own block (question + clickable
 *  options), NOT a Done card: no ✓, no Save. Distinct from a real summary. */
function ClarifyBlock({ question, options }: { question: string; options: string[] }) {
  return (
    <div className="clarify">
      {question && <div className="clarify-q" dangerouslySetInnerHTML={{ __html: mdToHtml(question) }} />}
      <div className="clarify-opts">
        {options.map((o, i) => (
          <button key={i} className="clarify-opt" onClick={() => post({ type: "send", text: o })}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A captured screenshot inlined on the run rail: a thumbnail that opens a
 *  full-size lightbox on click (click anywhere / Esc to close). */
function ShotNode({ uri }: { uri: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="node op shot">
      <span className="node-rail" />
      <div className="node-body">
        <div className="shot-cap">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
            <circle cx="12" cy="12.5" r="3.2" />
          </svg>
          <span>Screenshot</span>
        </div>
        <img className="shot-thumb" src={uri} alt="screenshot" onClick={() => setOpen(true)} />
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(false)}>
          <img src={uri} alt="screenshot" />
        </div>
      )}
    </div>
  );
}

function GroupNode({ label, items }: { label: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"node op group" + (open ? " open" : "")}>
      <span className="node-rail" />
      <div className="node-body">
        <div className="grp-head" onClick={() => setOpen((o) => !o)}>
          <span className="caret">▸</span>
          <span>{label}</span>
          <span className="grp-count">
            {" · "}
            {items.length} {items.length === 1 ? "file" : "files"}
          </span>
        </div>
        {open && (
          <div className="grp-list">
            {items.map((d, i) => (
              <div className="grp-item" key={i}>
                {d}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Per-mode artifact noun for the after-run save line.
const SAVE_NOUN: Record<string, string> = {
  "api-test": "API test",
  pentest: "report",
};

function ResultBlock({ item }: { item: Extract<ThreadItem, { kind: "result" }> }) {
  const meta: string[] = [];
  if (item.steps) meta.push(item.steps + (item.steps > 1 ? " steps" : " step"));
  if (item.tokens) meta.push(item.tokens.toLocaleString() + " tok");
  // No auto-save: a small inline "Save" button on the footer line lets the user
  // export on demand (routes by mode → name prompt → saves).
  const noun = SAVE_NOUN[item.mode ?? ""] ?? "spec";
  const rows =
    item.findings.length > 0 ? structuredRows(item.findings) : item.findingsText ? textRows(item.findingsText) : [];
  return (
    <div className={"result" + (item.error ? " err" : "")}>
      <div className="rhead">
        <span className="rcheck">{item.error ? "✗" : "✓"}</span>
        <span>{item.verdict}</span>
        <CopyBtn getText={() => item.main} />
      </div>
      <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(stripHoverAsk(item.main)) }} />
      {rows.map((r, i) => (
        <div className="finding" key={i}>
          {r.word && <span className={"badge " + sevClass(r.word)}>{r.word}</span>}
          <span dangerouslySetInnerHTML={{ __html: r.html }} />
          <CopyBtn getText={() => (r.word ? r.word + " — " : "") + stripHtml(r.html)} />
        </div>
      ))}
      {/* Only a run that actually did something is worth saving — a 0-step run
          (the agent just replied / asked) shows no footer at all. */}
      {!item.error && (item.steps ?? 0) > 0 && (
        <div className="rfoot">
          This run took {meta.join(" · ")}. Want to{" "}
          <button className="save-btn" onClick={() => post({ type: "saveRun", mode: item.mode ?? null })}>
            Save
          </button>{" "}
          this {noun}?
        </div>
      )}
    </div>
  );
}
