import type { InvokeEvent } from '@hover-dev/core';
import type { StreamLine } from '../app.js';

/* Normalize core's `InvokeEvent` stream into the run-pane's `StreamLine`s.
 * Pure + injectable so it's unit-testable without spawning an agent. */

let _id = 0;
/** Monotonic id for stream lines — shared by the mapper and the session hook so
 *  React keys never collide. */
export const nextLineId = (): number => ++_id;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Strip the `mcp__<server>__` prefix → the bare tool name. */
function bareTool(tool: string): string {
  const parts = tool.split('__');
  return parts[0] === 'mcp' && parts.length >= 3 ? parts.slice(2).join('__') : tool;
}

/** A short, human-readable one-liner for a tool call — the readable run stream. */
export function describeTool(tool: string, input: unknown): string {
  const t = bareTool(tool);
  const a = asRecord(input);
  const target = str(a.name) ?? str(a.role) ?? str(a.text) ?? str(a.testId);
  switch (t) {
    case 'click_control':
      return target ? `click ${quote(target)}` : 'click';
    case 'fill_control':
      // Field name only — never echo the typed value (could be a credential).
      return target ? `fill ${quote(target)}` : 'fill';
    case 'select_control':
      return target ? `select ${quote(target)}` : 'select';
    case 'check_control':
      return `${a.checked === false ? 'uncheck' : 'check'} ${target ? quote(target) : ''}`.trim();
    case 'upload_file':
      return 'upload file';
    case 'assert_visible':
      return target ? `assert ${quote(target)} visible` : 'assert visible';
    case 'take_screenshot':
    case 'browser_take_screenshot':
      return 'screenshot';
    case 'browser_navigate':
      return `navigate → ${str(a.url) ?? ''}`.trim();
    case 'browser_snapshot':
      return 'read page';
    case 'browser_tabs':
      return `tabs${str(a.action) ? ` (${str(a.action)})` : ''}`;
    case 'record_candidate':
      return target ? `propose flow ${quote(target)}` : 'propose flow';
    case 'record_fact':
      return target ? `note ${quote(target)}` : 'note a fact';
    case 'ask_user':
      return `ask: ${str(a.question) ?? ''}`.trim();
    default:
      return t;
  }
}

function quote(s: string): string {
  return `"${s.length > 48 ? s.slice(0, 47) + '…' : s}"`;
}

/** Build a stateful event→line mapper. Returns `null` for events that don't
 *  warrant a stream line (usage/raw, empty text, clean tool results). */
export function createEventMapper(): (ev: InvokeEvent) => StreamLine | null {
  return (ev) => {
    switch (ev.kind) {
      case 'session_start':
        return { id: nextLineId(), kind: 'info', text: `session started${ev.model ? ` · ${ev.model}` : ''}` };
      case 'mcp_status':
        return { id: nextLineId(), kind: 'info', text: `${ev.server}: ${ev.status}` };
      case 'text': {
        const text = str(ev.text);
        return text ? { id: nextLineId(), kind: 'narration', text } : null;
      }
      case 'tool_use':
        return { id: nextLineId(), kind: 'tool', text: describeTool(ev.tool, ev.input) };
      case 'tool_result':
        return ev.isError ? { id: nextLineId(), kind: 'error', text: str(ev.preview) ?? 'tool error' } : null;
      case 'session_end':
        return {
          id: nextLineId(),
          kind: ev.isError ? 'error' : 'info',
          text: ev.cancelled ? 'cancelled' : str(ev.summary) ?? (ev.isError ? 'ended with error' : 'done'),
        };
      case 'usage':
      case 'raw':
        return null;
      default:
        return null;
    }
  };
}
