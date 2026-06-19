import { useEffect, useRef, useState } from "react";
import { onMessage } from "./vscode";
import { isQuietStep, coalesceKind, describeOp, presentLabel, groupDetail, GROUP_LABEL, type StepMsg } from "./ops";
import { splitFindings } from "./markdown";

export interface Finding {
  title?: string;
  text?: string;
  severity?: string;
  method?: string;
  endpoint?: string;
}

export type ThreadItem =
  | { kind: "user"; text: string }
  | { kind: "think"; text: string }
  | { kind: "op"; text: string; error?: boolean }
  | { kind: "answered"; text: string }
  | { kind: "group"; label: string; items: string[] }
  | { kind: "system"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "result";
      verdict: string;
      main: string;
      findings: Finding[];
      findingsText: string | null;
      steps?: number;
      tokens?: number;
      error: boolean;
    };

function makeResult(m: Record<string, unknown>): ThreadItem {
  const verdict = String(m.verdict || "Done");
  const summary = String(m.summary || "");
  const structured = Array.isArray(m.findings) ? (m.findings as Finding[]) : [];
  const split = structured.length ? { main: summary, findings: null } : splitFindings(summary);
  return {
    kind: "result",
    verdict,
    main: split.main,
    findings: structured,
    findingsText: split.findings,
    steps: typeof m.steps === "number" ? m.steps : undefined,
    tokens: typeof m.tokens === "number" ? m.tokens : undefined,
    error: /fail|error|blocked/i.test(verdict),
  };
}

/**
 * Builds the run-thread item list from the streamed messages — the React
 * equivalent of the legacy imperative DOM builder. A narration is held PENDING
 * and only committed when its first op arrives (or dropped when the run's result
 * lands), so the final narration never flashes. Consecutive source reads/lists
 * coalesce into one expandable group.
 */
export function useThread(): { items: ThreadItem[]; workLabel: string | null } {
  const [items, setItems] = useState<ThreadItem[]>([]);
  // The live operation label for the "working" indicator — tracks the agent's
  // current activity so the foot-of-thread status matches what's happening
  // (e.g. "Clicking" / "Reading source"), instead of a generic spinner word.
  const [workLabel, setWorkLabel] = useState<string | null>(null);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    return onMessage((raw) => {
      const m = raw as Record<string, unknown>;
      switch (m.type) {
        case "user":
          setWorkLabel("Thinking");
          setItems((p) => {
            const next = [...p];
            flushPending(next, pending);
            next.push({ kind: "user", text: String(m.text || "") });
            return next;
          });
          break;
        case "narration": {
          const text = String(m.text || "").trim();
          if (!text) break;
          setWorkLabel("Thinking");
          setItems((p) => {
            const next = [...p];
            flushPending(next, pending); // commit the previous thought
            pending.current = text; // hold this one until its first op
            return next;
          });
          break;
        }
        case "step": {
          const step = m as StepMsg;
          // Update the live label even for "quiet" steps (snapshot / wait) so the
          // indicator reflects them, but don't add a thread item for those.
          setWorkLabel(presentLabel(step.tool, step.detail));
          if (isQuietStep(step)) break;
          setItems((p) => {
            const next = [...p];
            flushPending(next, pending);
            const ck = coalesceKind(step.tool);
            if (ck) {
              const last = next[next.length - 1];
              const label = GROUP_LABEL[ck];
              if (last && last.kind === "group" && last.label === label) {
                next[next.length - 1] = { ...last, items: [...last.items, groupDetail(step)] };
              } else {
                next.push({ kind: "group", label, items: [groupDetail(step)] });
              }
            } else {
              next.push({ kind: "op", text: describeOp(step.tool, step.detail), error: step.isError });
            }
            return next;
          });
          break;
        }
        case "result":
          pending.current = null; // the result's summary supersedes the final thought
          setWorkLabel(null);
          setItems((p) => [...p, makeResult(m)]);
          break;
        case "system":
          setItems((p) => [...p, { kind: "system", text: String(m.text || "") }]);
          break;
        case "assistant":
          setItems((p) => [...p, { kind: "assistant", text: String(m.text || "") }]);
          break;
        case "_answered":
          // Local (not from the host): drop a concise "You answered: …" node
          // onto the thread after an ask_user card resolves.
          setItems((p) => [...p, { kind: "answered", text: String(m.text || "") }]);
          break;
        case "loadSession":
          pending.current = null;
          setWorkLabel(null);
          setItems(buildFromTranscript(Array.isArray(m.transcript) ? (m.transcript as Record<string, unknown>[]) : []));
          break;
        case "reset":
          pending.current = null;
          setWorkLabel(null);
          setItems([]);
          break;
      }
    });
  }, []);

  return { items, workLabel };
}

function flushPending(list: ThreadItem[], pending: { current: string | null }) {
  if (pending.current) {
    list.push({ kind: "think", text: pending.current });
    pending.current = null;
  }
}

/** Rebuild the thread from a persisted session transcript (on conversation
 *  switch). Transcript kinds differ from the live stream: narration is `ai`,
 *  and a step carries the raw `input` object (not a JSON `detail` string). */
function buildFromTranscript(tx: Record<string, unknown>[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  const pending = { current: null as string | null };
  const flush = () => flushPending(items, pending);
  for (const e of tx) {
    switch (e.kind) {
      case "user":
        flush();
        items.push({ kind: "user", text: String(e.text || "") });
        break;
      case "ai": {
        const t = String(e.text || "").trim();
        if (t) {
          flush();
          pending.current = t;
        }
        break;
      }
      case "step": {
        const step: StepMsg = {
          tool: e.tool as string | undefined,
          detail: e.input != null ? JSON.stringify(e.input) : (e.detail as string | undefined),
          isError: e.isError as boolean | undefined,
        };
        if (isQuietStep(step)) break;
        flush();
        const ck = coalesceKind(step.tool);
        if (ck) {
          const last = items[items.length - 1];
          const label = GROUP_LABEL[ck];
          if (last && last.kind === "group" && last.label === label) {
            items[items.length - 1] = { ...last, items: [...last.items, groupDetail(step)] };
          } else {
            items.push({ kind: "group", label, items: [groupDetail(step)] });
          }
        } else {
          items.push({ kind: "op", text: describeOp(step.tool, step.detail), error: step.isError });
        }
        break;
      }
      case "done":
        pending.current = null;
        items.push(
          makeResult({ verdict: e.isError ? "Failed" : "Done", summary: e.summary, findings: e.findings }),
        );
        break;
      case "system":
        items.push({ kind: "system", text: String(e.text || "") });
        break;
    }
  }
  return items;
}
