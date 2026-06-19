import { Fragment, useState } from "react";
import type { ThreadItem } from "./useThread";
import { inline, mdToHtml } from "./markdown";
import { structuredRows, textRows, sevClass } from "./findings";

const NODE_KINDS = new Set(["think", "op", "group"]);

/** The run thread: node-rail items (think / op / source-group) grouped into a
 *  `.run` rail, with user/system/assistant as plain messages and the Done block
 *  as a result card. */
export function Thread({ items }: { items: ThreadItem[] }) {
  // Chunk consecutive node-items into a single `.run` so the rail connects them.
  const chunks: { run: boolean; items: ThreadItem[] }[] = [];
  for (const it of items) {
    const isNode = NODE_KINDS.has(it.kind);
    const last = chunks[chunks.length - 1];
    if (last && last.run === isNode) last.items.push(it);
    else chunks.push({ run: isNode, items: [it] });
  }

  return (
    <>
      {chunks.map((chunk, ci) =>
        chunk.run ? (
          <div className="run" key={ci}>
            {chunk.items.map((it, i) => (
              <Node key={i} item={it} />
            ))}
          </div>
        ) : (
          <Fragment key={ci}>
            {chunk.items.map((it, i) => (
              <Node key={i} item={it} />
            ))}
          </Fragment>
        ),
      )}
    </>
  );
}

function Node({ item }: { item: ThreadItem }) {
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
          <div className="node-body">{item.text}</div>
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
      </div>
      <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(item.main) }} />
      {rows.map((r, i) => (
        <div className="finding" key={i}>
          {r.word && <span className={"badge " + sevClass(r.word)}>{r.word}</span>}
          <span dangerouslySetInnerHTML={{ __html: r.html }} />
        </div>
      ))}
      {meta.length > 0 && <div className="rfoot">{meta.join(" · ")}</div>}
    </div>
  );
}
