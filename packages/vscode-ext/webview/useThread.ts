import { useEffect, useRef, useState } from "react";
import { onMessage } from "./vscode";
import { isQuietStep, coalesceKind, describeOp, groupDetail, GROUP_LABEL, type StepMsg } from "./ops";
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
export function useThread(): ThreadItem[] {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    return onMessage((raw) => {
      const m = raw as Record<string, unknown>;
      switch (m.type) {
        case "user":
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
          setItems((p) => [...p, makeResult(m)]);
          break;
        case "system":
          setItems((p) => [...p, { kind: "system", text: String(m.text || "") }]);
          break;
        case "assistant":
          setItems((p) => [...p, { kind: "assistant", text: String(m.text || "") }]);
          break;
        case "reset":
          pending.current = null;
          setItems([]);
          break;
      }
    });
  }, []);

  return items;
}

function flushPending(list: ThreadItem[], pending: { current: string | null }) {
  if (pending.current) {
    list.push({ kind: "think", text: pending.current });
    pending.current = null;
  }
}
