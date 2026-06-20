import type { ThreadItem } from "./useThread";

/**
 * Turn an agent's plain-text clarifying question into clickable options.
 *
 * A CLI agent often *asks* the user a question (with a numbered list of choices)
 * and ends its turn, instead of calling the ask_user tool. Rather than fight the
 * agent's tool choice, we detect that case and render the choices as buttons —
 * clicking one sends it as the next message, which resumes the agent.
 */

/** The structured block the agent is prompted to emit for a multiple-choice
 *  question: ```hover-ask\n- option 1\n- option 2\n``` (the question itself
 *  stays as normal prose before it). Deterministic — no guessing the agent's
 *  markdown. */
// Tolerant: matches even when the agent leaves the block UNCLOSED (no trailing
// ```), is case-sloppy, or trails junk on the fence line — captures to the
// closing fence OR end of text, so a malformed block is still parsed + stripped
// (never leaked as raw ``` to the UI).
const HOVER_ASK_RE = /```hover-ask[^\n]*\n?([\s\S]*?)(?:```|$)/i;

/** Options from a `hover-ask` block, or [] when there's no block. */
export function parseHoverAsk(text: string): string[] {
  const m = text.match(HOVER_ASK_RE);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.match(/^[-*•]\s+(.+)$/)?.[1] ?? l).replace(/\*\*(.+?)\*\*/g, "$1").trim())
    .filter(Boolean);
}

/** Remove the `hover-ask` block from text shown to the user (the options render
 *  as buttons instead; the question prose before the block stays). */
export function stripHoverAsk(text: string): string {
  return HOVER_ASK_RE.test(text) ? text.replace(HOVER_ASK_RE, "").trimEnd() : text;
}

/** Drop `think` (narration) nodes whose text duplicates a later result /
 *  assistant message. The agent's final answer is emitted BOTH as a streamed
 *  narration (which can get committed to a think node) and as the run summary —
 *  showing both reads as a duplicate. Applied at render so it covers the live
 *  stream AND a reloaded transcript. Compared with the hover-ask block stripped
 *  from both sides. */
export function dedupeThread(items: ThreadItem[]): ThreadItem[] {
  const norm = (s: string) => stripHoverAsk(s).trim();
  const finals = items
    .map((i) =>
      i.kind === "result" ? i.main : i.kind === "assistant" ? i.text : i.kind === "clarify" ? i.question : null,
    )
    .filter((s): s is string => !!s)
    .map(norm)
    .filter(Boolean);
  if (!finals.length) return items;
  return items.filter(
    (i) => !(i.kind === "think" && finals.some((f) => f === norm(i.text) || f.includes(norm(i.text)))),
  );
}

/** Parse a choice list — numbered (`1.` `1)` `1、`) OR bulleted (`-` `*` `•`),
 *  e.g. "- **Full flow**——…\n- Just step 1" → ["Full flow——…", "Just step 1"].
 *  Markdown bold/inline-code markup is stripped so the chip + the sent text read
 *  clean. */
export function followupOptions(text: string): string[] {
  const opts: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^(?:\d+\s*[.)、．:]|[-*•])\s+(.+)$/);
    if (!m) continue;
    const opt = m[1]
      .replace(/\*\*(.+?)\*\*/g, "$1") // **bold** → bold
      .replace(/`([^`]+)`/g, "$1") // `code` → code
      .trim();
    if (opt) opts.push(opt);
  }
  return opts;
}

/**
 * THE discriminator between a run's two final-message roles:
 *  - a "clarification" (the agent is asking the user to choose) → returns the
 *    question + options, rendered as its own block with buttons, NO Done/Save;
 *  - a real summary → returns null → rendered as a Done result.
 *
 * A clarification is signalled by a `hover-ask` block (the prompted, reliable
 * form). Fallback: a question mark + a numbered/bulleted list of ≥2 options (so
 * a Findings list of numbered results never reads as a question).
 */
export function clarifyFrom(text: string): { question: string; options: string[] } | null {
  if (!text) return null;
  // Structured block (deterministic) — the question is the prose before it.
  const structured = parseHoverAsk(text);
  if (structured.length) return { question: stripHoverAsk(text).trim(), options: structured };
  // Heuristic fallback — only when the text is actually a question.
  if (!/[?？]/.test(text)) return null;
  const opts = followupOptions(text);
  if (opts.length < 2) return null;
  // Question = the text with the option/list lines removed.
  const question = text
    .split("\n")
    .filter((l) => !/^\s*(?:\d+\s*[.)、．:]|[-*•])\s+/.test(l))
    .join("\n")
    .trim();
  // The QUESTION prose itself must be a question — guards against a real summary
  // whose "?" sits inside a list item / Findings entry (then the bullets are
  // results, not choices).
  if (!/[?？]/.test(question)) return null;
  return { question, options: opts };
}
