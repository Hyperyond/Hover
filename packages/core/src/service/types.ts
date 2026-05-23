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

import type { WebSocket } from 'ws';
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
  };
}

export function send(ws: WebSocket, message: { type: string; payload?: unknown }): void {
  ws.send(JSON.stringify(message));
}
