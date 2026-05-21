/**
 * Translate the captured `browser_*` tool calls into plain English.
 *
 * Used by:
 *   - writeSpec.ts — to enrich the generated `.spec.ts` JSDoc with a
 *     numbered "Steps:" block that QA / PMs can read without grokking
 *     `getByRole(...)`.
 *   - writeCaseCsv.ts — to populate the Step column of an
 *     Xray-compatible test case CSV, so the same prose travels into
 *     Jira / Xray / Zephyr.
 *
 * Mirrors the tool dispatch table in writeSpec.ts:translateStep — when
 * a new replayable browser action is added there, add it here too.
 */
import type { SkillStep } from '../skills/writeSkill.js';

/** A single human-readable line for one tool call, or null to skip. */
export function humanStep(tool: string, rawInput: unknown): string | null {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'browser_navigate': {
      const url = String(input.url ?? '').trim();
      return url ? `Open ${url}` : null;
    }
    case 'browser_click':
      return `Click ${describe(input.element)}`;
    case 'browser_double_click':
      return `Double-click ${describe(input.element)}`;
    case 'browser_hover':
      return `Hover over ${describe(input.element)}`;
    case 'browser_type': {
      const text = String(input.text ?? '');
      return `Type ${quote(text)} into ${describe(input.element)}`;
    }
    case 'browser_fill_form': {
      const fields = (input.fields as unknown[] | undefined) ?? [];
      if (fields.length === 0) return null;
      // Join multi-field fills into one sentence to keep the Steps block
      // compact on long forms. Per-field bullets would balloon a 7-step
      // flow into 30 lines.
      const parts = fields.map(raw => {
        const f = raw as { name?: string; value?: string; element?: string };
        const target = f.name ?? f.element ?? 'field';
        return `${target}=${quote(String(f.value ?? ''))}`;
      });
      return `Fill ${parts.join(', ')}`;
    }
    case 'browser_select_option': {
      const target = describe(input.element);
      const values = input.values as unknown[] | undefined;
      const val = (values && values.length > 0 ? values[0] : input.value) ?? '';
      return `Select ${quote(String(val))} in ${target}`;
    }
    case 'browser_press_key': {
      const key = String(input.key ?? '');
      return key ? `Press ${key}` : null;
    }
    // Diagnostic / read-only — same skip list as writeSpec.translateStep.
    case 'browser_wait_for':
    case 'browser_tabs':
    case 'browser_snapshot':
    case 'browser_take_screenshot':
    case 'browser_resize':
    case 'browser_evaluate':
    case 'browser_console_messages':
    case 'browser_network_requests':
      return null;
    default:
      // Unknown tools shouldn't pollute the prose; the spec emitter
      // already drops a TODO comment in the code for these, that's
      // enough signal for the developer.
      return null;
  }
}

/**
 * Walk a captured session's step events and return a flat list of
 * human-readable lines, with consecutive identical sentences collapsed
 * into "<sentence> (× N)". Empty array if the session had no replayable
 * tool calls (only diagnostics / text / done).
 */
export function humanSteps(steps: SkillStep[]): string[] {
  const out: string[] = [];
  let lastSentence: string | null = null;
  let repeatCount = 0;
  for (const s of steps) {
    if (s.kind !== 'step' || !s.tool) continue;
    const sentence = humanStep(s.tool, s.input);
    if (sentence == null) continue;
    if (sentence === lastSentence) {
      repeatCount += 1;
      // Re-write the previous line with an incremented multiplier.
      out[out.length - 1] = `${sentence} (× ${repeatCount + 1})`;
    } else {
      out.push(sentence);
      lastSentence = sentence;
      repeatCount = 0;
    }
  }
  return out;
}

// ───────── helpers ─────────

function describe(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return s.length > 0 ? s : 'the target element';
}

/** Wrap in double-quotes for prose; escape internal quotes. */
function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
