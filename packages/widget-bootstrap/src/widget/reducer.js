/**
 * Pure transforms for the Hover chat widget. No DOM access, no shadow root,
 * no fetch — just data in, data out. This file is the single source of
 * truth for:
 *
 *   - `groupMessages(messages, isLiveRun)` — turn the raw event log into
 *     a sequence of rendered cards (user / group / report / findings / etc.)
 *   - `extractFindings(summary)` — pull the `## Findings` block out of an
 *     agent's final summary
 *   - `stripMarkdown(md)` — remove markdown syntax for the Report card's
 *     plain-text rendition
 *   - `classifySeverity(marker)` — map "Bug" / "Minor" / etc. to a severity
 *
 * Both the browser widget (via `transformIndexHtml` string concatenation,
 * with `export` keywords stripped) and the vitest suite import these.
 * Keep this file free of `window`, `document`, or DOM references.
 */

// ─── Constants ──────────────────────────────────────────────────────────

// Words/patterns that turn an ai narration line into a user-visible row.
// Conservative — we'd rather drop one too many lines than drown the user
// in "Let me check this and then drive through each feature" narration.
export const NOTEWORTHY_AI = /\b(error|fail(ed|ure|ing)?|issue|warning|problem|bug|unexpected|notice that|noticed|found|broken|missing|cannot|can't|wasn't|isn't|doesn't|didn't|incorrect|wrong)\b/i;

// Tools the widget never surfaces — they're internal to how the agent
// composes a session and have no meaning to the user reading the run.
export const HIDDEN_TOOLS = new Set([
  // Skill: agent calling a previously-saved Hover skill (replay script).
  // The browser_* tools that the skill itself triggers DO appear, but
  // attributed to whichever natural-language title is in flight, not
  // labeled "Skill".
  'Skill',
]);

// Tools that strongly suggest a logical "new chapter" starts here. Seeing
// one of these forces a new group even if the agent kept narrating
// continuously. Keeps a group from ballooning to 40 tools under a single
// "Let me explore" title.
export const BOUNDARY_TOOLS = new Set([
  'browser_navigate',
  'browser_fill_form',
  'TaskCreate',
]);

// Hard cap: a group of more than this many tools is split, even without a
// boundary tool. Stops "Let me drive through each feature" from becoming
// one 40-step monolith.
export const MAX_TOOLS_PER_GROUP = 6;

// Findings parsing — match `## Findings`, `### Bugs`, `## Issues` etc.
export const FINDINGS_HEADER_RE = /^#{2,3}\s*(Findings|Bugs|Issues)\s*$/im;
// Match a list item; capture optional **marker** prefix and the text.
export const FINDING_LINE_RE = /^\s*[-*]\s+(?:\*\*\s*(.+?)\s*\*\*\s*[—–-]\s*)?(.+)$/;

// ─── Helpers ─────────────────────────────────────────────────────────────

export function classifySeverity(marker) {
  if (!marker) return 'info';
  const m = marker.toLowerCase();
  if (/bug|critical|severe|fail/.test(m)) return 'bug';
  if (/minor|warning|note/.test(m)) return 'minor';
  return 'info';
}

/**
 * Convert agent-emitted markdown into a plain-text rendition for the
 * Report card. We don't try to preserve any visual hierarchy — the user
 * has told us they prefer pure text over a half-rendered markdown soup.
 *
 * Rules:
 *   - Strip leading ATX headings (#, ##, ###) but keep the title text
 *   - Strip **bold** / *italic* / `code` markers, keep their content
 *   - Strip leading `- ` / `* ` / `1. ` list markers but keep the item text
 *   - Strip `---` horizontal rules entirely
 *   - Collapse runs of 3+ blank lines to one blank line
 */
export function stripMarkdown(md) {
  if (!md || typeof md !== 'string') return '';
  const lines = md.split('\n');
  const out = [];
  for (const raw of lines) {
    let line = raw;
    if (/^\s*-{3,}\s*$/.test(line) || /^\s*\*{3,}\s*$/.test(line)) continue;
    line = line.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
    line = line.replace(/^\s*[-*+]\s+/, '');
    line = line.replace(/^(\s*)\d+\.\s+/, '$1');
    line = line.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    line = line.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
    line = line.replace(/`([^`\n]+)`/g, '$1');
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse `## Findings` (or `### Findings`, `## Bugs`, etc.) from the end of
 * a session summary. Returns { findings: [{severity, marker, text}], rest }
 * where `rest` is the summary text with the Findings block stripped out.
 *
 * Recognised severity markers (case-insensitive):
 *   - "Bug" / "Bug #N"           → severity: 'bug'
 *   - "Critical" / "Severe"      → severity: 'bug'
 *   - "Minor" / "Warning" / "Note" → severity: 'minor'
 *   - anything else / no marker  → severity: 'info'
 */
export function extractFindings(summary) {
  if (!summary || typeof summary !== 'string') return { findings: [], rest: summary };
  const lines = summary.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FINDINGS_HEADER_RE.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { findings: [], rest: summary };

  const findings = [];
  let i = headerIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{2,3}\s+\S/.test(line)) break;
    const m = FINDING_LINE_RE.exec(line);
    if (m) {
      findings.push({
        severity: classifySeverity(m[1]),
        marker: m[1] || null,
        text: m[2].trim(),
      });
    }
    i++;
  }

  if (findings.length === 0) return { findings: [], rest: summary };

  const rest = lines.slice(0, headerIdx).join('\n').trim() || null;
  return { findings, rest };
}

// ─── Reducer ─────────────────────────────────────────────────────────────

/**
 * Turn the raw message log into a sequence of cards for rendering. Pure
 * function — same input always produces the same output.
 *
 * Aggregation rules (heuristic, no agent-prompt changes required):
 *   - 'user'   → new turn boundary
 *   - 'ai'     → buffered as `pendingTitle`. Promoted to the next group's
 *                title when a step arrives. Otherwise: shown standalone
 *                ONLY when it contains a noteworthy keyword.
 *   - 'step'   → folds into the open group; opens a new group if none.
 *                Hidden tools (Skill) drop entirely. Boundary tools
 *                (browser_navigate / browser_fill_form / TaskCreate) and
 *                group-size overflow force a new group.
 *   - 'done'   → closes the open group, emits a Report card (and Findings
 *                card if the summary contained a `## Findings` block).
 *   - 'system' → standalone system row, doesn't open/close a group.
 *
 * Groups have a status: 'running' | 'ok' | 'error'. The last group during
 * a live session is 'running' until 'done' arrives.
 *
 * Status is a BUSINESS-LEVEL signal: did the agent complete the logical
 * step the user asked for? It is NOT a tool-level signal. A tool call
 * that returned `is_error: true` is just one retry attempt — the agent
 * routinely re-tries with a different selector / approach inside the
 * same step and recovers. Marking the whole step red because one tool
 * call failed inside it (the prior behaviour) made successful runs look
 * mostly-broken to the user. Now: a group is red ONLY if the
 * session-level `done.isError` is true (agent itself reported failure).
 * Individual tool errors are still preserved in `step.isError` and
 * rendered as red lines when the user expands the group — diagnostic
 * info stays available, top-level status reflects the business outcome.
 */
export function groupMessages(messages, isLiveRun) {
  const groups = [];
  let open = null;            // { kind: 'group', title, steps, status }
  let pendingTitle = null;    // last unconsumed ai text — promoted to title on next step
  let lastAiText = null;      // remembered for the done-card summary fallback

  const closeOpen = (status) => {
    if (open && open.kind === 'group') {
      open.status = status;
      groups.push(open);
      open = null;
    }
  };

  const flushPendingTitleAsBubble = () => {
    if (pendingTitle) {
      if (NOTEWORTHY_AI.test(pendingTitle)) {
        groups.push({ kind: 'ai', text: pendingTitle });
      }
      pendingTitle = null;
    }
  };

  const titleFromTool = (tool, input) => {
    const arg = input && typeof input === 'object'
      ? (input.text ?? input.selector ?? input.url ?? input.role ?? input.name ?? '')
      : '';
    const short = arg ? ` (${String(arg).slice(0, 30)})` : '';
    return `${tool}${short}`;
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (m.kind === 'user') {
      flushPendingTitleAsBubble();
      closeOpen('ok');
      lastAiText = null;
      groups.push({ kind: 'user', text: m.text });
      continue;
    }

    if (m.kind === 'system') {
      flushPendingTitleAsBubble();
      closeOpen('ok');
      groups.push({ kind: 'system', text: m.text });
      continue;
    }

    if (m.kind === 'ai') {
      flushPendingTitleAsBubble();
      pendingTitle = m.text;
      lastAiText = m.text;
      continue;
    }

    if (m.kind === 'step') {
      if (HIDDEN_TOOLS.has(m.tool)) continue;

      // Split BEFORE adding this step when (a) it's a boundary tool or
      // (b) the open group is already at MAX_TOOLS_PER_GROUP.
      // A mid-stream split closes with 'ok' — the only thing that can
      // turn a group red is the session-level `done.isError` at the
      // very end. See the function-level comment on business vs tool
      // status semantics.
      if (open && open.kind === 'group') {
        const isBoundary = BOUNDARY_TOOLS.has(m.tool);
        const isFull = open.steps.length >= MAX_TOOLS_PER_GROUP;
        if (isBoundary || isFull) {
          closeOpen('ok');
        }
      }

      if (!open || open.kind !== 'group') {
        open = {
          kind: 'group',
          title: pendingTitle ?? titleFromTool(m.tool, m.input),
          steps: [],
          status: 'running',
          startedAt: m.at ?? null,
          endedAt: null,
          costStartUsd: m.costUsdSnapshot ?? null,
          costEndUsd: m.costUsdSnapshot ?? null,
        };
        pendingTitle = null;
      }
      // step.isError is kept on each tool line for the expanded view —
      // users can drill in to see which retries failed — but it no
      // longer escalates to the group's top-level status.
      open.steps.push({ tool: m.tool, input: m.input, isError: !!m.isError });
      if (typeof m.costUsdSnapshot === 'number') open.costEndUsd = m.costUsdSnapshot;
      if (m.at != null) open.endedAt = m.at;
      continue;
    }

    if (m.kind === 'done') {
      const rawSummary = (m.summary && m.summary.trim().length > 0)
        ? m.summary
        : (pendingTitle || lastAiText) || null;
      const { findings, rest } = extractFindings(rawSummary);

      if (open && open.kind === 'group') {
        // Business-level: only the session's own isError marks the
        // step red. Individual tool retries don't escalate.
        open.status = m.isError ? 'error' : 'ok';
        open.summary = null;
        groups.push(open);
        open = null;
      }

      const reportText = rest ? stripMarkdown(rest) : '';
      if (reportText || m.turns != null || m.costUsd != null) {
        groups.push({
          kind: 'report',
          text: reportText || null,
          isError: !!m.isError,
          turns: m.turns,
          costUsd: m.costUsd,
          saveable: !m.isError,
          source: m.source || 'agent',
        });
      }

      if (findings.length > 0) {
        groups.push({ kind: 'findings', findings });
      }

      pendingTitle = null;
      continue;
    }
  }

  // End of stream. An open group with no 'done' means the run is still live.
  // Status: running while live; 'ok' on a finished-but-no-done stream
  // (e.g. localStorage snapshot of a session that was cut off mid-run).
  // Tool-level retries inside the group don't change the conclusion.
  if (open) {
    open.status = isLiveRun ? 'running' : 'ok';
    groups.push(open);
  }
  if (pendingTitle && !isLiveRun) flushPendingTitleAsBubble();

  return groups;
}
