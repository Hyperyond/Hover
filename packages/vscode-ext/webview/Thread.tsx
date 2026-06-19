import { Fragment, useEffect, useState } from "react";
import type { ThreadItem } from "./useThread";
import { inline, mdToHtml } from "./markdown";
import { structuredRows, textRows, sevClass } from "./findings";

const NODE_KINDS = new Set(["think", "op", "group", "answered"]);

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

// Rotating status verbs for a live run, cycled with a typing reveal — like
// Claude Code's animated status, so "Working…" isn't a dead label.
const WORK_WORDS = ["Working", "Thinking", "Exploring", "Reasoning", "Checking", "Planning"];

/** Live indicator on the thread rail — a spinning Chrome ring + a status word.
 *  A timed busy job (optimize) shows its fixed label + mm:ss; a plain run cycles
 *  the verbs above, each typed out. */
function WorkingNode({ text, timer }: { text: string; timer: boolean }) {
  const [s, setS] = useState(0); // busy-job elapsed seconds
  const [wi, setWi] = useState(0); // current word
  const [n, setN] = useState(0); // chars typed of current word

  useEffect(() => {
    if (!timer) return;
    const start = Date.now();
    const iv = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [timer]);

  useEffect(() => {
    if (timer) return;
    const word = WORK_WORDS[wi];
    if (n < word.length) {
      const t = setTimeout(() => setN(n + 1), 55);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setWi((wi + 1) % WORK_WORDS.length);
      setN(0);
    }, 1500);
    return () => clearTimeout(t);
  }, [timer, wi, n]);

  const word = WORK_WORDS[wi];
  const done = n >= word.length;
  return (
    <div className="node op working">
      <span className="node-rail">
        <span className="work-ico" />
      </span>
      <div className="node-body">
        {timer ? (
          <>
            {text}
            <span className="busy-time">
              {" "}
              {Math.floor(s / 60)}:{("0" + (s % 60)).slice(-2)}
            </span>
          </>
        ) : (
          <>
            <span className={done ? "" : "typing"}>{word.slice(0, n)}</span>
            {done && "…"}
          </>
        )}
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
      return <div className="msg assistant">{item.text}</div>;
    case "think":
      return (
        <div className="node think">
          <span className="node-rail" />
          <div className="node-body" dangerouslySetInnerHTML={{ __html: inline(item.text) }} />
        </div>
      );
    case "op":
      return (
        <div className={"node op" + (item.error ? " error" : "")}>
          <span className="node-rail" />
          <div className="node-body">
            <Typed text={item.text} animate={last} />
          </div>
        </div>
      );
    case "answered":
      return (
        <div className="node op answered">
          <span className="node-rail" />
          <div className="node-body" dangerouslySetInnerHTML={{ __html: inline(item.text) }} />
        </div>
      );
    case "group":
      return <GroupNode label={item.label} items={item.items} />;
    case "result":
      return <ResultBlock item={item} />;
  }
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

function ResultBlock({ item }: { item: Extract<ThreadItem, { kind: "result" }> }) {
  const meta: string[] = [];
  if (item.steps) meta.push(item.steps + (item.steps > 1 ? " steps" : " step"));
  if (item.tokens) meta.push(item.tokens.toLocaleString() + " tok");
  const rows =
    item.findings.length > 0 ? structuredRows(item.findings) : item.findingsText ? textRows(item.findingsText) : [];
  return (
    <div className={"result" + (item.error ? " err" : "")}>
      <div className="rhead">
        <span className="rcheck">{item.error ? "✗" : "✓"}</span>
        <span>{item.verdict}</span>
        <CopyBtn getText={() => item.main} />
      </div>
      <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(item.main) }} />
      {rows.map((r, i) => (
        <div className="finding" key={i}>
          {r.word && <span className={"badge " + sevClass(r.word)}>{r.word}</span>}
          <span dangerouslySetInnerHTML={{ __html: r.html }} />
          <CopyBtn getText={() => (r.word ? r.word + " — " : "") + stripHtml(r.html)} />
        </div>
      ))}
      {meta.length > 0 && <div className="rfoot">{meta.join(" · ")}</div>}
    </div>
  );
}
