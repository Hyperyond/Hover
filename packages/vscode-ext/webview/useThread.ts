import { useEffect, useRef, useState } from "react";
import { onMessage } from "./vscode";
import { isQuietStep, coalesceKind, describeOp, presentLabel, opVerb, groupDetail, GROUP_LABEL, type StepMsg } from "./ops";
import { splitFindings } from "./markdown";
import { dedupeThread, clarifyFrom } from "./followup";

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
  | { kind: "op"; text: string; verb?: string; error?: boolean }
  | { kind: "answered"; text: string }
  | { kind: "group"; label: string; items: string[] }
  | { kind: "shot"; uri: string; full?: boolean }
  | { kind: "system"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "clarify"; question: string; options: string[] }
  | {
      kind: "result";
      verdict: string;
      main: string;
      findings: Finding[];
      findingsText: string | null;
      steps?: number;
      tokens?: number;
      error: boolean;
      mode?: string | null;
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
    mode: typeof m.mode === "string" ? m.mode : null,
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
              next.push({ kind: "op", text: describeOp(step.tool, step.detail), verb: opVerb(step.tool), error: step.isError });
            }
            return next;
          });
          break;
        }
        case "screenshot": {
          const uri = String(m.uri || "");
          if (!uri) break;
          const full = Boolean(m.full);
          setItems((p) => {
            const next = [...p];
            flushPending(next, pending);
            // The agent often takes a full-page AND a viewport shot of the same
            // view back-to-back. Collapse a consecutive burst into one thumbnail,
            // preferring the full-page one. A new "moment" (an op/narration lands
            // between shots) isn't adjacent, so it shows separately.
            const last = next[next.length - 1];
            if (last && last.kind === "shot") {
              if (last.full && !full) return next; // keep the full-page, drop the viewport
              next[next.length - 1] = { kind: "shot", uri, full };
              return next;
            }
            next.push({ kind: "shot", uri, full });
            return next;
          });
          break;
        }
        case "result":
          // A `result` is only sent for a run with real (saveable) actions, so
          // it's a genuine summary — always a Done card (keeps findings + Save),
          // never a clarification. Clarifications come via `assistant` (0-action
          // runs, below).
          pending.current = null; // the result's summary supersedes the final thought
          setWorkLabel(null);
          setItems((p) => [...p, makeResult(m)]);
          break;
        case "system":
          setItems((p) => [...p, { kind: "system", text: String(m.text || "") }]);
          break;
        case "assistant": {
          const text = String(m.text || "");
          const c = clarifyFrom(text);
          setItems((p) => [...p, c ? { kind: "clarify", question: c.question, options: c.options } : { kind: "assistant", text }]);
          break;
        }
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

  // Dedupe at the single exit — covers both the live stream and a reloaded
  // transcript: drop narration that duplicates the final result/assistant.
  return { items: dedupeThread(items), workLabel };
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
          items.push({ kind: "op", text: describeOp(step.tool, step.detail), verb: opVerb(step.tool), error: step.isError });
        }
        break;
      }
      case "shot": {
        const uri = String(e.uri || "");
        if (!uri) break;
        const full = Boolean(e.full);
        flush();
        // Same full+viewport burst collapse as the live path.
        const prev = items[items.length - 1];
        if (prev && prev.kind === "shot") {
          if (prev.full && !full) break;
          items[items.length - 1] = { kind: "shot", uri, full };
          break;
        }
        items.push({ kind: "shot", uri, full });
        break;
      }
      case "done": {
        pending.current = null;
        const summary = String(e.summary || "");
        const steps = typeof e.steps === "number" ? e.steps : 0;
        // Mirror the live path: a 0-action run is a clarification (question +
        // buttons) or a plain reply; a run with real actions is a Done card
        // (keeps findings + Save). Never turn a worked run into a clarification.
        if (!e.isError && steps === 0) {
          const c = clarifyFrom(summary);
          items.push(c ? { kind: "clarify", question: c.question, options: c.options } : { kind: "assistant", text: summary });
        } else {
          items.push(
            makeResult({ verdict: e.isError ? "Failed" : "Done", summary: e.summary, findings: e.findings, mode: e.mode, steps: e.steps, tokens: e.tokens }),
          );
        }
        break;
      }
      case "system":
        items.push({ kind: "system", text: String(e.text || "") });
        break;
    }
  }
  return items;
}
