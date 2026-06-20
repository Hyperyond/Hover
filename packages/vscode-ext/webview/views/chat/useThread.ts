import { useEffect, useMemo, useState } from "react";
import { onMessage } from "../../shared/vscode";
import { isQuietStep, coalesceKind, describeOp, presentLabel, opVerb, groupDetail, GROUP_LABEL, type StepMsg } from "./ops";
import { splitFindings } from "../../shared/markdown";
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

/** One persisted/normalized transcript entry. Both the live stream and a
 *  reloaded session funnel into this single vocabulary
 *  (user/ai/step/shot/done/system/answered) so the thread is derived by ONE
 *  function — see `buildThread`. */
type Tx = Record<string, unknown>;

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
 * The chat thread is a PURE function of a single transcript array. The live
 * stream and a reloaded session both normalize into one event vocabulary
 * (user/ai/step/shot/done/system/answered) and append to `transcript`; the
 * rendered `ThreadItem[]` is always re-derived by `buildThread`. There is no
 * second, parallel "live builder" — that duplication was the source of
 * live-vs-reload drift bugs.
 *
 * `workLabel` is ephemeral UI (the foot-of-thread "working" indicator) and is
 * tracked separately — it is not thread content.
 */
export function useThread(): { items: ThreadItem[]; workLabel: string | null } {
  const [transcript, setTranscript] = useState<Tx[]>([]);
  // The live operation label for the "working" indicator — tracks the agent's
  // current activity so the foot-of-thread status matches what's happening
  // (e.g. "Clicking" / "Reading source"), instead of a generic spinner word.
  const [workLabel, setWorkLabel] = useState<string | null>(null);

  useEffect(() => {
    return onMessage((raw) => {
      const m = raw as Record<string, unknown>;
      const append = (e: Tx) => setTranscript((t) => [...t, e]);
      switch (m.type) {
        case "user":
          setWorkLabel("Thinking");
          append({ kind: "user", text: String(m.text || "") });
          break;
        case "narration": {
          const text = String(m.text || "").trim();
          if (!text) break;
          setWorkLabel("Thinking");
          append({ kind: "ai", text });
          break;
        }
        case "step": {
          const step = m as StepMsg;
          // Update the live label even for "quiet" steps (snapshot / wait) so the
          // indicator reflects them; buildThread filters quiet steps from render.
          setWorkLabel(presentLabel(step.tool, step.detail));
          append({ kind: "step", tool: step.tool, detail: step.detail, isError: step.isError });
          break;
        }
        case "screenshot": {
          const uri = String(m.uri || "");
          if (!uri) break;
          append({ kind: "shot", uri, full: Boolean(m.full) });
          break;
        }
        case "result":
          // A `result` is only sent for a run with real (saveable) actions, so
          // it's a genuine summary — `forceResult` keeps it a Done card (findings
          // + Save) even if its step count rounds to 0, never a clarification.
          // Clarifications arrive via `assistant` (0-action runs, below).
          setWorkLabel(null);
          append({
            kind: "done",
            forceResult: true,
            verdict: m.verdict,
            summary: m.summary,
            findings: m.findings,
            mode: m.mode,
            steps: m.steps,
            tokens: m.tokens,
            isError: /fail|error|blocked/i.test(String(m.verdict || "")),
          });
          break;
        case "system":
          append({ kind: "system", text: String(m.text || "") });
          break;
        case "assistant":
          // A 0-action turn: a clarification (question + buttons) or a plain
          // reply. buildThread's `done` branch discriminates via clarifyFrom.
          append({ kind: "done", summary: String(m.text || ""), isError: false });
          break;
        case "_answered":
          // Local (not from the host): a concise "You answered: …" node dropped
          // onto the thread after an ask_user card resolves.
          append({ kind: "answered", text: String(m.text || "") });
          break;
        case "loadSession":
          setWorkLabel(null);
          setTranscript(Array.isArray(m.transcript) ? (m.transcript as Tx[]) : []);
          break;
        case "reset":
          setWorkLabel(null);
          setTranscript([]);
          break;
      }
    });
  }, []);

  // The thread is derived from the transcript on every change, then deduped
  // (drop narration that duplicates the final result/assistant). ONE code path
  // for live + reload.
  const items = useMemo(() => dedupeThread(buildThread(transcript)), [transcript]);
  return { items, workLabel };
}

function flushPending(list: ThreadItem[], pending: { current: string | null }) {
  if (pending.current) {
    list.push({ kind: "think", text: pending.current });
    pending.current = null;
  }
}

/**
 * Derive the rendered thread from a transcript — the SINGLE builder for both the
 * live stream and a reloaded session. A narration (`ai`) is held PENDING and
 * committed only when its first op arrives (so a trailing final thought never
 * flashes); consecutive source reads/lists coalesce into one expandable group;
 * a full-page + viewport screenshot burst collapses to one thumbnail.
 *
 * Step entries may carry either a raw `input` object (reloaded) or a JSON
 * `detail` string (live) — both are accepted.
 */
function buildThread(tx: Tx[]): ThreadItem[] {
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
          pending.current = t; // hold until its first op (or drop at `done`)
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
        // The agent often takes a full-page AND a viewport shot of the same view
        // back-to-back. Collapse a consecutive burst into one thumbnail,
        // preferring the full-page one. A new "moment" (an op/narration between
        // shots) isn't adjacent, so it shows separately.
        const prev = items[items.length - 1];
        if (prev && prev.kind === "shot") {
          if (prev.full && !full) break; // keep the full-page, drop the viewport
          items[items.length - 1] = { kind: "shot", uri, full };
          break;
        }
        items.push({ kind: "shot", uri, full });
        break;
      }
      case "done": {
        pending.current = null; // the summary supersedes the final thought
        const summary = String(e.summary || "");
        const steps = typeof e.steps === "number" ? e.steps : 0;
        // A 0-action run is a clarification (question + buttons) or a plain reply;
        // a run with real actions — or any `forceResult` (a host `result`) — is a
        // Done card (keeps findings + Save). Never turn a worked run into a
        // clarification.
        if (!e.isError && steps === 0 && !e.forceResult) {
          const c = clarifyFrom(summary);
          items.push(c ? { kind: "clarify", question: c.question, options: c.options } : { kind: "assistant", text: summary });
        } else {
          items.push(
            makeResult({
              verdict: e.verdict ?? (e.isError ? "Failed" : "Done"),
              summary: e.summary,
              findings: e.findings,
              mode: e.mode,
              steps: e.steps,
              tokens: e.tokens,
            }),
          );
        }
        break;
      }
      case "answered":
        items.push({ kind: "answered", text: String(e.text || "") });
        break;
      case "system":
        items.push({ kind: "system", text: String(e.text || "") });
        break;
    }
  }
  return items;
}
