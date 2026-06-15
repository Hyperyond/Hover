/**
 * Shared types for the service/ handler modules.
 *
 * `ClientMessage` describes the wire-protocol envelope every message from
 * the widget arrives in. Lives here (not in service.ts) so individual
 * handlers can type their `msg` argument without circular imports.
 *
 * `send` is the one-liner used by every handler to emit a typed message
 * back to the widget. Centralised so the JSON.stringify happens in exactly
 * one place.
 */

import { WebSocket } from 'ws';
import type { SkillStep } from '../skills/writeSkill.js';
import type { SpecAssertion } from '../specs/writeSpec.js';

export interface ClientMessage {
  type: string;
  payload?: {
    text?: string;
    sessionId?: string;
    name?: string;
    description?: string;
    steps?: SkillStep[];
    assertions?: SpecAssertion[];
    overwrite?: boolean;
    /** save-spec only — credentials to parameterize into process.env.<envVar>
     *  references so secrets never land in the spec / sidecar. */
    redactions?: { value: string; envVar: string }[];
    /** command only — test accounts the prompt referenced via @label. Injected
     *  into the agent's system prompt (ephemeral, not the saved transcript) so
     *  it can log in; the recorded fill values get redacted on save. */
    accounts?: { label: string; username?: string; password?: string; role?: string }[];
    /** save-case-csv only — passed through to writeCaseCsv as extra
     *  fields on the test case's Labels column. */
    jiraProjectKey?: string;
    labels?: string;
    /** check-cdp / launch-chrome / focus-debug — the widget's
     *  window.location.href so service can compare origins or navigate the
     *  newly-launched debug Chrome to the same URL. */
    pageUrl?: string;
    /** switch-agent only — id of the agent to switch the service to. */
    agentId?: string;
    /** set-model only — the model id to use for subsequent runs (e.g. opus). */
    model?: string;
    /** set-mode only — id of the plugin-contributed mode to activate,
     *  or null to return to normal (unmoded) operation. */
    modeId?: string | null;
    /** optimize-spec / promote-optimized / discard-optimized — the spec slug. */
    slug?: string;
    /** set-api-key only — the model API key to inject into the spawned CLI's
     *  env (or empty/missing to clear it). Held in memory only, never logged. */
    key?: string;
    /** launch-chrome only — launch the debug Chrome headless (silent mode). */
    headless?: boolean;
    /** launch-chrome only — close any existing debug Chrome first, then
     *  relaunch (so a headless↔visible switch / "reopen browser" takes effect). */
    force?: boolean;
    /** reveal-source only — a `data-hover-source` value (`<rel-path>:<line>:<col>`)
     *  an in-page client (widget) captured from a clicked element. The service
     *  relays it to every OTHER connected client; the VSCode extension listens
     *  for it and jumps the editor to that location (F2 page→editor transport). */
    source?: string;
    /** command only — the editor's source-read grant for this run:
     *  'always' (skip the gate), 'ask' (gate each read), 'deny' (no source MCP).
     *  Default 'ask' when absent. */
    sourceAccess?: 'always' | 'ask' | 'deny';
    /** command only — the active environment, recorded in the session ledger. */
    env?: { id?: string; name?: string };
    /** source-approval-request (from the source MCP) / -response (from the
     *  editor): a correlation id, the requested repo-relative path + kind, and
     *  the user's allow/deny decision. */
    approvalId?: string;
    sourcePath?: string;
    sourceKind?: string;
    allow?: boolean;
  };
}

export function send(ws: WebSocket, message: { type: string; payload?: unknown }): void {
  ws.send(JSON.stringify(message));
}

/** Send a message only if the socket is still open. Use this from delayed
 *  callbacks (promise `.then`, timers) where the client may have disconnected
 *  between scheduling and firing — calling `ws.send` on a closed socket
 *  is a silent no-op for some states and throws for others, so a single
 *  guarded helper makes the intent obvious and prevents surprises. */
export function sendIfOpen(
  ws: WebSocket,
  message: { type: string; payload?: unknown },
): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
}
